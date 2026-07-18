import type {
  AdapterConfigSchema,
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  ServerAdapterModule,
} from "../types.js";
import { asNumber, asString, parseObject } from "../utils.js";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_BASE_URL_ORIGIN = new URL(DEFAULT_BASE_URL).origin;
const DEFAULT_MODEL = "deepseek-chat";
const MODELS = [
  { id: "deepseek-chat", label: "DeepSeek Chat" },
  { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
];

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function normalizeBaseUrl(value: unknown): string {
  const raw = asString(value, DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function resolveBaseUrl(config: Record<string, unknown>): URL {
  let parsed: URL;
  try {
    parsed = new URL(normalizeBaseUrl(config.baseUrl));
  } catch {
    throw new Error("blocked: DeepSeek Platform base URL is invalid");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("blocked: DeepSeek Platform base URL must use HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("blocked: DeepSeek Platform base URL must not include credentials, query, or fragment");
  }

  const allowAuditedProxy = parseObject(config.security).allowAuditedProxyBaseUrl === true;
  if (parsed.origin !== DEFAULT_BASE_URL_ORIGIN && !allowAuditedProxy) {
    throw new Error("blocked: DeepSeek Platform base URL must be the official DeepSeek endpoint");
  }

  return parsed;
}

function resolveApiKey(config: Record<string, unknown>): string | null {
  const env = parseObject(config.env);
  for (const key of ["DEEPSEEK_API_KEY", "DEEPSEEK_PLATFORM_API_KEY"]) {
    const value = asString(env[key], "").trim();
    if (value) return value;
  }
  return null;
}

function buildPrompt(ctx: AdapterExecutionContext): string {
  const taskMarkdown = asString(ctx.context.paperclipTaskMarkdown, "").trim();
  if (taskMarkdown) return taskMarkdown;
  return JSON.stringify(ctx.context, null, 2);
}

function readAssistantText(payload: unknown): string {
  const root = parseObject(payload);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = parseObject(choices[0]);
  const message = parseObject(first.message);
  return asString(message.content, "").trim();
}

function readUsage(payload: unknown): AdapterExecutionResult["usage"] {
  const usage = parseObject(parseObject(payload).usage);
  const inputTokens = asNumber(usage.prompt_tokens, 0);
  const outputTokens = asNumber(usage.completion_tokens, 0);
  if (inputTokens <= 0 && outputTokens <= 0) return undefined;
  return { inputTokens, outputTokens };
}

async function callDeepSeek(input: {
  config: Record<string, unknown>;
  baseUrl: URL;
  prompt: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  const apiKey = resolveApiKey(input.config);
  if (!apiKey) {
    const err = new Error("blocked: DeepSeek provider auth missing");
    err.name = "DeepSeekAuthMissing";
    throw err;
  }

  const model = asString(input.config.model, DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const systemPrompt = asString(
    input.config.systemPrompt,
    "You are a Paperclip agent. Follow the task context, avoid secrets, and be concise.",
  );
  const maxTokens = Math.max(1, Math.floor(asNumber(input.config.maxTokens, 1200)));
  const temperature = Math.max(0, Math.min(2, asNumber(input.config.temperature, 0.2)));

  const response = await fetch(new URL("/chat/completions", input.baseUrl).toString(), {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.prompt },
      ],
      max_tokens: maxTokens,
      temperature,
      stream: false,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("blocked: DeepSeek provider auth rejected");
    }
    throw new Error(`DeepSeek Platform request failed with HTTP ${response.status}`);
  }

  return response.json();
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const config = parseObject(ctx.config);
  const model = asString(config.model, DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const timeoutMs = Math.max(1, asNumber(config.timeoutSec, 90)) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const baseUrl = resolveBaseUrl(config);
    await ctx.onMeta?.({
      adapterType: "deepseek_platform",
      command: "deepseek.chat.completions",
      commandNotes: [`baseUrlOrigin=${baseUrl.origin}`, `model=${model}`],
    });

    const payload = await callDeepSeek({
      config,
      baseUrl,
      prompt: buildPrompt(ctx),
      signal: controller.signal,
    });
    const text = readAssistantText(payload);
    if (text) {
      await ctx.onLog("stdout", `${text}\n`);
    }
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      provider: "deepseek",
      biller: "deepseek",
      model,
      billingType: "api",
      usage: readUsage(payload),
      summary: text ? text.slice(0, 500) : "DeepSeek Platform completed without assistant text.",
      resultJson: {
        provider: "deepseek",
        model,
        baseUrlOrigin: baseUrl.origin,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        exitCode: null,
        signal: null,
        timedOut: true,
        errorCode: "timeout",
        errorMessage: `DeepSeek Platform request timed out after ${timeoutMs}ms`,
        provider: "deepseek",
        model,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorCode: message.includes("auth missing")
        ? "deepseek_provider_auth_missing"
        : message.includes("auth rejected")
          ? "deepseek_provider_auth_rejected"
          : message.includes("base URL")
            ? "deepseek_base_url_rejected"
          : "deepseek_provider_error",
      errorMessage: message,
      provider: "deepseek",
      model,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const config = parseObject(ctx.config);
  const checks: AdapterEnvironmentCheck[] = [];

  try {
    const parsed = resolveBaseUrl(config);
    checks.push({
      code: "deepseek_base_url_valid",
      level: "info",
      message: `DeepSeek Platform base URL origin is ${parsed.origin}.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "DeepSeek Platform base URL is invalid.";
    checks.push({
      code: "deepseek_base_url_rejected",
      level: "error",
      message,
      hint: "Use https://api.deepseek.com unless an audited proxy has been explicitly allowed.",
    });
  }

  if (!resolveApiKey(config)) {
    checks.push({
      code: "deepseek_provider_auth_missing",
      level: "error",
      message: "blocked: DeepSeek provider auth missing",
      hint: "Bind DEEPSEEK_API_KEY through Paperclip company secrets; do not store a raw key in adapterConfig.",
    });
  } else {
    checks.push({
      code: "deepseek_provider_auth_configured",
      level: "info",
      message: "DeepSeek API key binding resolved for runtime.",
    });
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "baseUrl",
        label: "Base URL",
        type: "text",
        default: DEFAULT_BASE_URL,
        hint: "DeepSeek Platform API base URL. Keep the official URL unless using an audited proxy.",
      },
      {
        key: "maxTokens",
        label: "Max tokens",
        type: "number",
        default: 1200,
        hint: "Maximum completion tokens for each Paperclip wake.",
      },
      {
        key: "temperature",
        label: "Temperature",
        type: "number",
        default: 0.2,
        hint: "Sampling temperature from 0 to 2.",
      },
      {
        key: "systemPrompt",
        label: "System prompt",
        type: "textarea",
        default: "You are a Paperclip agent. Follow the task context, avoid secrets, and be concise.",
      },
    ],
  };
}

export const deepseekPlatformAdapter: ServerAdapterModule = {
  type: "deepseek_platform",
  execute,
  testEnvironment,
  models: MODELS,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: false,
  requiresMaterializedRuntimeSkills: false,
  getConfigSchema,
  agentConfigurationDoc: `# deepseek_platform agent configuration

Adapter: deepseek_platform

Core fields:
- model: DeepSeek model id, default ${DEFAULT_MODEL}
- baseUrl: DeepSeek API base URL, default ${DEFAULT_BASE_URL}
- env.DEEPSEEK_API_KEY: required Paperclip secret binding
- maxTokens: optional completion cap
- temperature: optional sampling temperature

Secrets must be provided through adapterConfig.env bindings and are resolved server-side at run time.
`,
};
