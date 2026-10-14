import type { RunRecord } from "./result-schema.js";

export type ModelSummary = {
  model: string;
  runs: number;
  errors: number;
  aborted: number;
  pass_rate: number;
  pass_k: number | null;
  mean_overall: number;
  policy_rate: number;
  handoff_rate: number;
  mean_turns: number;
  mean_tool_calls: number;
  p50_step_latency_ms: number | null;
  p95_step_latency_ms: number | null;
  total_cost_usd: number | null;
  cost_per_scenario_usd: number | null;
  user_cost_usd: number | null;
  by_category: Record<string, number>;
};

export type Summary = {
  run_id: string;
  date: string;
  harness_version: string;
  prompt_hash: string;
  mode: string;
  trials: number;
  scenario_count: number;
  user_model: string | null;
  models: ModelSummary[];
  categories: string[];
  cost: { cap_usd: number; spent_usd: number; cap_hit: boolean };
  notes: string[];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

// Nearest-rank percentile.
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

// A sum that stays null if any part is unknown, so a missing price never looks like $0.
function sumOrNull(xs: (number | null)[]): number | null {
  return xs.some((x) => x === null) ? null : xs.reduce<number>((a, b) => a + (b ?? 0), 0);
}

export function summarizeModel(model: string, runs: RunRecord[], trials: number): ModelSummary {
  const scenarios = [...new Set(runs.map((r) => r.scenario_id))];
  const byScenario = scenarios.map((id) => runs.filter((r) => r.scenario_id === id));
  const categories = [...new Set(runs.map((r) => r.category))].sort();
  const total = sumOrNull(runs.map((r) => r.metrics.cost_usd));
  const userCosts = runs.filter((r) => r.user_model).map((r) => r.metrics.user_cost_usd);
  const latencies = runs.flatMap((r) => r.metrics.latency_ms_per_step);
  return {
    model,
    runs: runs.length,
    errors: runs.filter((r) => r.status === "error").length,
    aborted: runs.filter((r) => r.status === "aborted").length,
    pass_rate: round(mean(runs.map((r) => (r.scores.pass ? 1 : 0)))),
    pass_k: trials > 1 ? round(mean(byScenario.map((rs) => (rs.every((r) => r.scores.pass) ? 1 : 0)))) : null,
    mean_overall: round(mean(runs.map((r) => r.scores.overall))),
    policy_rate: round(mean(runs.map((r) => r.scores.policy))),
    handoff_rate: round(mean(runs.map((r) => r.scores.handoff_correct))),
    mean_turns: round(mean(runs.map((r) => r.metrics.turns)), 2),
    mean_tool_calls: round(mean(runs.map((r) => r.metrics.tool_calls)), 2),
    p50_step_latency_ms: percentile(latencies, 50),
    p95_step_latency_ms: percentile(latencies, 95),
    total_cost_usd: total === null ? null : round(total, 6),
    cost_per_scenario_usd: total === null || !scenarios.length ? null : round(total / scenarios.length, 6),
    user_cost_usd: userCosts.length ? (sumOrNull(userCosts) === null ? null : round(sumOrNull(userCosts)!, 6)) : null,
    by_category: Object.fromEntries(categories.map((c) => [c, round(mean(runs.filter((r) => r.category === c).map((r) => (r.scores.pass ? 1 : 0))))])),
  };
}

export function aggregate(
  records: RunRecord[],
  meta: { runId: string; mode: string; trials: number; cap: number; spent: number; promptHash: string; harnessVersion: string; userModel: string | null },
): Summary {
  const models = [...new Set(records.map((r) => r.model))];
  const notes: string[] = [];
  const aborted = records.filter((r) => r.status === "aborted");
  const errors = records.filter((r) => r.status === "error");
  const capHit = aborted.length > 0;
  if (capHit) notes.push(`Cost cap of $${meta.cap.toFixed(2)} reached: ${aborted.length} runs aborted or not started.`);
  for (const r of errors) notes.push(`Error in ${r.scenario_id} / ${r.model} / trial ${r.trial}: ${r.error}`);
  const unpriced = models.filter((m) => records.some((r) => r.model === m && r.metrics.cost_usd === null));
  if (unpriced.length) notes.push(`No price known for ${unpriced.join(", ")}: cost shown as n/a.`);
  return {
    run_id: meta.runId,
    date: meta.runId.slice(0, 10),
    harness_version: meta.harnessVersion,
    prompt_hash: meta.promptHash,
    mode: meta.mode,
    trials: meta.trials,
    scenario_count: new Set(records.map((r) => r.scenario_id)).size,
    user_model: meta.userModel,
    models: models.map((m) => summarizeModel(m, records.filter((r) => r.model === m), meta.trials)),
    categories: [...new Set(records.map((r) => r.category))].sort(),
    cost: { cap_usd: meta.cap, spent_usd: round(meta.spent, 6), cap_hit: capHit },
    notes,
  };
}
