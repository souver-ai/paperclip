import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "../adapters/index.js";
import { deepseekPlatformAdapter } from "../adapters/deepseek-platform/index.js";

function buildCtx(config: Record<string, unknown>): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "DeepSeek Agent",
      adapterType: "deepseek_platform",
      adapterConfig: config,
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null,
    },
    config,
    context: {
      paperclipTaskMarkdown: "Paperclip task context:\n- Issue: \"SOU-1198\"",
    },
    onLog: vi.fn(),
    onMeta: vi.fn(),
  };
}

describe("deepseek_platform adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails explicitly when the DeepSeek secret binding is missing", async () => {
    const result = await deepseekPlatformAdapter.execute(buildCtx({ model: "deepseek-chat", env: {} }));

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("deepseek_provider_auth_missing");
    expect(result.errorMessage).toBe("blocked: DeepSeek provider auth missing");
  });

  it("invokes DeepSeek without exposing the API key in metadata or result JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "done" } }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const ctx = buildCtx({
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      env: {
        DEEPSEEK_API_KEY: "sk-test-secret",
      },
    });

    const result = await deepseekPlatformAdapter.execute(ctx);

    expect(result.exitCode).toBe(0);
    expect(result.provider).toBe("deepseek");
    expect(result.model).toBe("deepseek-chat");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(ctx.onLog).toHaveBeenCalledWith("stdout", "done\n");
    expect(ctx.onMeta).toHaveBeenCalledWith({
      adapterType: "deepseek_platform",
      command: "deepseek.chat.completions",
      commandNotes: ["baseUrlOrigin=https://api.deepseek.com", "model=deepseek-chat"],
    });
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
    expect(JSON.stringify((ctx.onMeta as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("sk-test-secret");
  });

  it("rejects unsafe base URLs before metadata or network calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctx = buildCtx({
      model: "deepseek-chat",
      baseUrl: "http://api.deepseek.com?token=leak",
      env: {
        DEEPSEEK_API_KEY: "sk-test-secret",
      },
    });

    const result = await deepseekPlatformAdapter.execute(ctx);

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("deepseek_base_url_rejected");
    expect(result.errorMessage).toBe("blocked: DeepSeek Platform base URL must use HTTPS");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.onMeta).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("token=leak");
  });

  it("rejects non-official base URLs unless an audited proxy is explicitly allowed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekPlatformAdapter.execute(buildCtx({
      model: "deepseek-chat",
      baseUrl: "https://proxy.example.test",
      env: {
        DEEPSEEK_API_KEY: "sk-test-secret",
      },
    }));

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("deepseek_base_url_rejected");
    expect(result.errorMessage).toBe("blocked: DeepSeek Platform base URL must be the official DeepSeek endpoint");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports auth as a test-environment blocker without probing live APIs", async () => {
    const result = await deepseekPlatformAdapter.testEnvironment({
      companyId: "company-1",
      adapterType: "deepseek_platform",
      config: { baseUrl: "https://api.deepseek.com", env: {} },
    });

    expect(result.status).toBe("fail");
    expect(result.checks.some((check) => check.code === "deepseek_provider_auth_missing")).toBe(true);
  });

  it("reports rejected base URLs as environment-test blockers", async () => {
    const result = await deepseekPlatformAdapter.testEnvironment({
      companyId: "company-1",
      adapterType: "deepseek_platform",
      config: {
        baseUrl: "https://proxy.example.test",
        env: { DEEPSEEK_API_KEY: "sk-test-secret" },
      },
    });

    expect(result.status).toBe("fail");
    expect(result.checks).toContainEqual(expect.objectContaining({
      code: "deepseek_base_url_rejected",
      level: "error",
    }));
  });
});
