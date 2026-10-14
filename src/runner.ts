import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wrapLanguageModel, type LanguageModel } from "ai";
import { promptHash, TEMPERATURE } from "./agent/loop.js";
import { runConversation, type ConversationResult } from "./conversation.js";
import { createBackend } from "./backend/store.js";
import { cassetteMiddleware, CostCapError, type CassetteMode, type Meter } from "./providers/cassette.js";
import { costUsd, PRICING, type Price, type Usage } from "./providers/pricing.js";
import { getModel } from "./providers/registry.js";
import type { Scenario } from "./scenarios/schema.js";
import { aggregate, type Summary } from "./scoring/aggregate.js";
import { RunRecordSchema, type RunRecord } from "./scoring/result-schema.js";
import { scoreRun } from "./scoring/scorers.js";
import { createToolbox } from "./tools/index.js";

export const HARNESS_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export const DEFAULT_MAX_COST_USD = 2;

export type RunOptions = {
  scenarios: Scenario[];
  models: string[];
  trials?: number;
  mode?: CassetteMode;
  userModel?: string;
  concurrency?: number;
  maxCostUsd?: number;
  outDir?: string;
  cassetteDir?: string;
  runId?: string;
  pricing?: Record<string, Price>;
  resolveModel?: (spec: string) => LanguageModel;
};

export function createMeter(capUsd: number, pricing: Record<string, Price>): Meter & { spent: () => number; capped: () => boolean } {
  let spent = 0;
  let capped = false;
  return {
    check() {
      if (spent >= capUsd) {
        capped = true;
        throw new CostCapError(`Cost cap reached: spent $${spent.toFixed(4)} of $${capUsd.toFixed(2)}`);
      }
    },
    add: (model: string, u: Usage) => void (spent += costUsd(model, u, pricing) ?? 0),
    spent: () => spent,
    capped: () => capped,
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const sumUsage = (steps: Usage[]): Usage => ({
  input_tokens: sum(steps.map((s) => s.input_tokens)),
  cached_input_tokens: sum(steps.map((s) => s.cached_input_tokens)),
  output_tokens: sum(steps.map((s) => s.output_tokens)),
});

export function newRunId(): string {
  return `${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}Z_${Math.random().toString(16).slice(2, 6)}`;
}

export async function runEval(o: RunOptions): Promise<{ runId: string; outDir: string; records: RunRecord[]; summary: Summary }> {
  const mode = o.mode ?? "replay";
  const trials = o.trials ?? 1;
  const pricing = o.pricing ?? PRICING;
  const cap = o.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  const resolve = o.resolveModel ?? ((spec: string) => getModel(spec, { requireKey: mode === "live" || mode === "record" }));
  const runId = o.runId ?? newRunId();
  const outDir = o.outDir ?? join("results", runId);
  const meter = createMeter(cap, pricing);
  const needsUser = o.scenarios.some((s) => s.user.mode === "llm");
  if (needsUser && !o.userModel) throw new Error("Some scenarios use an LLM customer: pass --user-model");
  if (mode !== "replay") {
    for (const m of [...o.models, ...(needsUser ? [o.userModel!] : [])]) {
      if (!pricing[m]) throw new Error(`No price for ${m} in src/providers/pricing.ts, so the cost cap cannot be enforced`);
    }
  }
  const hash = promptHash(createToolbox(createBackend()));

  const jobs = o.models.flatMap((model) => o.scenarios.flatMap((scenario) => Array.from({ length: trials }, (_, t) => ({ model, scenario, trial: t + 1 }))));
  const records: RunRecord[] = new Array(jobs.length);

  async function runJob(i: number) {
    const { model, scenario, trial } = jobs[i]!;
    const wrap = (spec: string) =>
      wrapLanguageModel({
        model: resolve(spec) as Parameters<typeof wrapLanguageModel>[0]["model"],
        middleware: cassetteMiddleware({ model: spec, mode, trial, scenario: scenario.id, dir: o.cassetteDir, meter }),
      });
    const userSpec = scenario.user.mode === "llm" ? o.userModel! : null;
    let conv: ConversationResult;
    if (meter.capped()) conv = notStarted(scenario);
    else {
      try {
        conv = await runConversation(scenario, { agent: wrap(model), user: userSpec ? wrap(userSpec) : undefined });
      } catch (e) {
        conv = { ...notStarted(scenario), error: e instanceof Error ? e.message : String(e) };
      }
    }
    const aborted = conv.ended_by === "error" && meter.capped() ? ("cost_cap" as const) : null;
    const agentTexts = conv.transcript.filter((t) => t.role === "assistant").map((t) => t.content);
    const { scores, failures } = scoreRun(scenario, conv.tool_log, agentTexts, conv.final_state);
    const usage = sumUsage(conv.agent_steps);
    const userUsage = sumUsage(conv.user_steps);
    records[i] = RunRecordSchema.parse({
      run_id: runId,
      scenario_id: scenario.id,
      category: scenario.category,
      model,
      user_model: userSpec,
      trial,
      mode,
      harness_version: HARNESS_VERSION,
      prompt_hash: hash,
      temperature: TEMPERATURE,
      status: aborted ? "aborted" : conv.ended_by === "error" && !conv.model_error ? "error" : "completed",
      aborted,
      error: conv.error,
      ended_by: conv.ended_by,
      scores,
      failures: conv.error ? [`${conv.model_error ? "model error" : "run error"}: ${conv.error}`, ...failures] : failures,
      metrics: {
        turns: conv.turns,
        steps: conv.agent_steps.length,
        tool_calls: conv.tool_log.length,
        tool_errors: conv.tool_log.filter((t) => t.error_code !== null).length,
        ...usage,
        cost_usd: costUsd(model, usage, pricing),
        user_cost_usd: userSpec ? costUsd(userSpec, userUsage, pricing) : null,
        latency_ms_total: sum(conv.agent_steps.map((s) => s.latency_ms)),
        latency_ms_per_step: conv.agent_steps.map((s) => s.latency_ms),
      },
      transcript: conv.transcript,
      tool_log: conv.tool_log,
      final_state: conv.final_state,
    });
  }

  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, jobs.length)) }, async () => {
    while (next < jobs.length) await runJob(next++);
  });
  await Promise.all(workers);

  const summary = aggregate(records, { runId, mode, trials, cap, spent: meter.spent(), promptHash: hash, harnessVersion: HARNESS_VERSION, userModel: o.userModel ?? null });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "runs.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  return { runId, outDir, records, summary };
}

// Runs skipped because the cap was already hit still get a record, so the summary shows them.
function notStarted(scenario: Scenario): ConversationResult {
  return {
    transcript: [],
    tool_log: [],
    agent_steps: [],
    user_steps: [],
    turns: 0,
    ended_by: "error",
    final_state: createBackend({ seed: scenario.seed, fixtures: scenario.fixtures, clock: scenario.clock }).snapshot(),
    error: "not started: cost cap reached",
    model_error: false,
  };
}
