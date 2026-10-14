import type { Summary } from "../scoring/aggregate.js";
import type { RunRecord } from "../scoring/result-schema.js";

export const RESULT_HEADERS = ["Model", "Pass rate", "pass^k", "Overall", "Policy", "Handoff", "Avg turns", "Avg tool calls", "p50 / p95 step latency", "Cost per scenario", "Total cost"];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (x: number | null) => (x === null ? "n/a" : `$${x.toFixed(4)}`);
const ms = (x: number | null) => (x === null ? "n/a" : `${Math.round(x)}`);

export function resultRows(s: Summary): string[][] {
  return s.models.map((m) => [
    m.model,
    pct(m.pass_rate),
    m.pass_k === null ? "n/a" : pct(m.pass_k),
    m.mean_overall.toFixed(3),
    pct(m.policy_rate),
    pct(m.handoff_rate),
    m.mean_turns.toFixed(2),
    m.mean_tool_calls.toFixed(2),
    `${ms(m.p50_step_latency_ms)} / ${ms(m.p95_step_latency_ms)} ms`,
    usd(m.cost_per_scenario_usd),
    usd(m.total_cost_usd),
  ]);
}

export function categoryRows(s: Summary): string[][] {
  return s.categories.map((c) => [c, ...s.models.map((m) => (m.by_category[c] === undefined ? "n/a" : pct(m.by_category[c]!)))]);
}

export function failingRuns(records: RunRecord[], model: string): RunRecord[] {
  return records.filter((r) => r.model === model && !r.scores.pass);
}

export const anchor = (r: Pick<RunRecord, "model" | "scenario_id" | "trial">) => `${r.model}-${r.scenario_id}-${r.trial}`.replace(/[^\w-]/g, "-");

export function headerLines(s: Summary): string[] {
  return [
    `Date: ${s.date}`,
    `Harness version: ${s.harness_version}`,
    `Prompt hash: ${s.prompt_hash.slice(0, 12)}`,
    `Mode: ${s.mode}`,
    `Models: ${s.models.map((m) => m.model).join(", ")}`,
    `Customer model (llm scenarios): ${s.user_model ?? "none"}`,
    `Scenarios: ${s.scenario_count}, trials: ${s.trials}`,
  ];
}

const mdTable = (headers: string[], rows: string[][]) =>
  [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

export function readmeTable(s: Summary): string {
  return mdTable(RESULT_HEADERS, resultRows(s));
}

export function renderMarkdown(s: Summary, records: RunRecord[]): string {
  const out = [`# Eval report ${s.run_id}`, "", ...headerLines(s).map((l) => `- ${l}`), "", "## Results", "", readmeTable(s), ""];
  out.push("## Pass rate by category", "", mdTable(["Category", ...s.models.map((m) => m.model)], categoryRows(s)), "");
  out.push("## Failures", "");
  for (const m of s.models) {
    const failed = failingRuns(records, m.model);
    out.push(`### ${m.model}`, "");
    if (!failed.length) out.push("No failing runs.");
    for (const r of failed) {
      out.push(`- [${r.scenario_id}${s.trials > 1 ? ` (trial ${r.trial})` : ""}](report.html#${anchor(r)}): ${r.failures.filter((f) => !f.startsWith("note:")).join("; ") || "failed"}`);
    }
    out.push("");
  }
  out.push("## Notes", "", ...s.notes.map((n) => `- ${n}`), `- Spend in this invocation: $${s.cost.spent_usd.toFixed(4)} (cap $${s.cost.cap_usd.toFixed(2)}). Replayed calls count as $0.`, "");
  // Model text can contain dashes, which the repo bans as raw characters; entities render the same.
  return out.join("\n").replace(/[\u2013\u2014]/g, (c) => `&#${c.charCodeAt(0)};`);
}
