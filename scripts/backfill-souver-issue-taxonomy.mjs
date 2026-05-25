#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const allStatuses = args.has("--all-statuses");
const baseUrl = (process.env.PAPERCLIP_API_BASE ?? process.env.PAPERCLIP_BASE_URL ?? "http://100.123.149.12:3100")
  .replace(/\/$/, "");
const companyId = process.env.PAPERCLIP_COMPANY_ID ?? process.env.SOUVER_PAPERCLIP_COMPANY_ID;
const token = process.env.PAPERCLIP_API_KEY ?? process.env.PAPERCLIP_API_TOKEN ?? process.env.SOUVER_PAPERCLIP_API_TOKEN;

if (!companyId) {
  console.error("Missing PAPERCLIP_COMPANY_ID or SOUVER_PAPERCLIP_COMPANY_ID.");
  process.exit(1);
}

const categories = new Set([
  "feature",
  "process",
  "bugfix",
  "test_review",
  "security_audit",
  "harness_benchmark",
  "architecture_review",
  "kb_docs",
  "ops",
  "approval",
  "research",
  "acquisition",
  "funding",
  "uncategorized",
]);
const surfaces = new Set([
  "paperclip",
  "dashboard",
  "app_cli",
  "desktop",
  "inference",
  "souver_research",
  "parent_kb_ops",
  "external",
]);

function headers() {
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${body.slice(0, 300)}`);
  }
  return response.json();
}

function textFor(issue) {
  return [
    issue.identifier,
    issue.title,
    issue.description,
    issue.project?.name,
    ...(issue.labels ?? []).map((label) => label.name),
  ].filter(Boolean).join(" ").toLowerCase();
}

function classify(issue) {
  const text = textFor(issue);
  const matched = [];
  const nextSurfaces = new Set();
  let category = "uncategorized";

  const categoryRules = [
    ["security_audit", /\b(security|cve|vuln|audit|siem|rls|xss|csrf|auth|secret|advisory)\b/],
    ["harness_benchmark", /\b(harness|benchmark|baseline|eval|experiment|exp-|c5|c6|terminal-bench)\b/],
    ["test_review", /\b(test|e2e|playwright|vitest|validation|evidence|qa|review)\b/],
    ["architecture_review", /\b(architecture|adr|rfc|design review|technical decision)\b/],
    ["kb_docs", /\b(kb|doc|docs|documentation|obsidian|pilotage|readme|knowledge)\b/],
    ["approval", /\b(approval|approve|decision benjamin|blocked_needs_benjamin|board)\b/],
    ["acquisition", /\b(acquisition|linkedin|seo|geo|marketing|prospect|outreach)\b/],
    ["funding", /\b(funding|grant|subvention|bpi|financement)\b/],
    ["process", /\b(process|routine|dispatcher|governance|triage|workflow|operating system)\b/],
    ["bugfix", /\b(bug|fix|regression|broken|crash|error|timeout|fail(ed|ing)?)\b/],
    ["research", /\b(research|veille|paper|competitor|deep research)\b/],
    ["ops", /\b(ops|backup|migration|deploy|sync|notifier|infra)\b/],
    ["feature", /\b(feature|story|epic|add|implement|surface|ui|sidebar|inbox)\b/],
  ];
  for (const [candidate, pattern] of categoryRules) {
    if (pattern.test(text)) {
      category = candidate;
      matched.push(`category:${candidate}`);
      break;
    }
  }

  const surfaceRules = [
    ["paperclip", /\b(paperclip|blocked inbox|approval board|sidebar|issue|agent|routine)\b/],
    ["dashboard", /\b(dashboard|souver\.ai|nextjs|next\.js|netlify|supabase|stripe)\b/],
    ["app_cli", /\b(app|cli|souver-cli|codex|terminal|slash)\b/],
    ["desktop", /\b(desktop|electron|macos|windows|dmg|nsis)\b/],
    ["inference", /\b(inference|gpu|outscale|vllm|router|model registry)\b/],
    ["souver_research", /\b(research|harness|benchmark|baseline|experiment|eval)\b/],
    ["parent_kb_ops", /\b(kb|doc|obsidian|pilotage|ops|script|sync|agenda)\b/],
    ["external", /\b(external|client|vendor|provider|outreach)\b/],
  ];
  for (const [surface, pattern] of surfaceRules) {
    if (pattern.test(text)) {
      nextSurfaces.add(surface);
      matched.push(`surface:${surface}`);
    }
  }

  const currentCategory = categories.has(issue.category) ? issue.category : "uncategorized";
  const currentSurfaces = Array.isArray(issue.surfaces)
    ? issue.surfaces.filter((surface) => surfaces.has(surface))
    : [];
  const patch = {};
  if (currentCategory === "uncategorized" && category !== "uncategorized") patch.category = category;
  if (currentSurfaces.length === 0 && nextSurfaces.size > 0) patch.surfaces = [...nextSurfaces];

  const highConfidence = matched.length > 0 && Object.keys(patch).length > 0;
  return { category, surfaces: [...nextSurfaces], patch, matched, highConfidence };
}

function sample(items) {
  return items.slice(0, 12).map((item) => `- ${item}`).join("\n") || "- none";
}

const issueQuery = new URLSearchParams({
  includeRoutineExecutions: "true",
  includePluginOperations: "true",
  limit: "1000",
});
if (!allStatuses) {
  issueQuery.set("status", "backlog,todo,in_progress,in_review,blocked");
}

const issues = await request(`/api/companies/${companyId}/issues?${issueQuery.toString()}`);
const changed = [];
const skipped = [];
const ambiguous = [];

for (const issue of issues) {
  const result = classify(issue);
  const ref = issue.identifier ?? issue.id;
  if (!result.highConfidence) {
    ambiguous.push(`${ref}: ${issue.title}`);
    continue;
  }
  changed.push(`${ref}: ${issue.title} -> ${JSON.stringify(result.patch)} (${result.matched.join(", ")})`);
  if (apply) {
    await request(`/api/issues/${issue.id}`, {
      method: "PATCH",
      body: JSON.stringify(result.patch),
    });
  }
}

for (const issue of issues) {
  const currentCategory = categories.has(issue.category) ? issue.category : "uncategorized";
  const currentSurfaces = Array.isArray(issue.surfaces) ? issue.surfaces : [];
  if (currentCategory !== "uncategorized" || currentSurfaces.length > 0) {
    skipped.push(`${issue.identifier ?? issue.id}: already classified`);
  }
}

console.log(`# Souver Issue Taxonomy Backfill ${apply ? "Apply" : "Dry Run"}`);
console.log("");
console.log(`- Base URL: ${baseUrl}`);
console.log(`- Company ID: ${companyId}`);
console.log(`- Mode: ${apply ? "apply" : "dry-run"}`);
console.log(`- Status scope: ${allStatuses ? "all" : "active-only"}`);
console.log(`- Issues scanned: ${issues.length}`);
console.log(`- High-confidence changes: ${changed.length}`);
console.log(`- Already classified: ${skipped.length}`);
console.log(`- Ambiguous or no-op: ${ambiguous.length}`);
console.log("");
console.log("## Changed");
console.log(sample(changed));
console.log("");
console.log("## Already Classified");
console.log(sample(skipped));
console.log("");
console.log("## Ambiguous / No Auto-Mutation");
console.log(sample(ambiguous));
