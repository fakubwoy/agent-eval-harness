import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { renderHtml } from "./report/html.js";
import { readmeTable, renderMarkdown } from "./report/markdown.js";
import { DEFAULT_USER_MODEL, parseSpec } from "./providers/registry.js";
import { DEFAULT_MAX_COST_USD, runEval } from "./runner.js";
import { loadScenarios, selectScenarios } from "./scenarios/loader.js";
import { validateScenario } from "./scenarios/validate.js";
import { aggregate } from "./scoring/aggregate.js";
import { RunRecordSchema } from "./scoring/result-schema.js";

export const USAGE = `Usage: npx tsx src/cli.ts <command> [flags]

Commands:
  run        Run scenarios x models x trials and score them
               --models a,b,c          provider:model list (required)
               --scenarios <sel>       glob, id or category:x (default all)
               --trials N              (default 1)
               --mode live|record|replay|auto   (default replay)
               --user-model provider:model      model playing the customer in llm scenarios (default ${DEFAULT_USER_MODEL})
               --allow-same-user-model          let the customer model also be a compared model
               --concurrency N         (default 4)
               --max-cost USD          (default env MAX_RUN_COST_USD or ${DEFAULT_MAX_COST_USD.toFixed(2)})
               --out dir               (default results/<run_id>)
  report     Write report.md and report.html for a results directory
               --in results/<run_id>
               --readme                print only the Markdown results table
  validate   Check every scenario against the schema and the backend
               --scenarios <sel>
  list       List scenarios with id, category and user mode

Exit codes for run: 0 all runs completed (failing scores are not errors), 1 harness error or replay miss, 2 cost cap reached.
`;

const RunFlags = z.object({
  models: z.string({ error: "--models is required" }).transform((s) => s.split(",").map((m) => m.trim()).filter(Boolean)),
  scenarios: z.string().optional(),
  trials: z.coerce.number().int().min(1).default(1),
  mode: z.enum(["live", "record", "replay", "auto"]).default("replay"),
  "user-model": z.string().default(DEFAULT_USER_MODEL),
  "allow-same-user-model": z.boolean().default(false),
  concurrency: z.coerce.number().int().min(1).default(4),
  "max-cost": z.coerce.number().positive().optional(),
  out: z.string().optional(),
});

export async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      models: { type: "string" },
      scenarios: { type: "string" },
      trials: { type: "string" },
      mode: { type: "string" },
      "user-model": { type: "string" },
      "allow-same-user-model": { type: "boolean" },
      concurrency: { type: "string" },
      "max-cost": { type: "string" },
      out: { type: "string" },
      in: { type: "string" },
      readme: { type: "boolean" },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    return 0;
  }
  switch (command) {
    case "run":
      return run(values);
    case "report":
      return report(z.object({ in: z.string({ error: "--in is required" }), readme: z.boolean().default(false) }).parse(values));
    case "validate":
      return validate(values.scenarios);
    case "list":
      return list();
    default:
      console.error(`Unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}

async function run(raw: Record<string, unknown>): Promise<number> {
  const f = RunFlags.parse(raw);
  f.models.forEach(parseSpec);
  const scenarios = selectScenarios(loadScenarios(), f.scenarios);
  const needsUser = scenarios.some((s) => s.user.mode === "llm");
  if (needsUser && f.models.includes(f["user-model"]) && !f["allow-same-user-model"]) {
    throw new Error(`The customer model ${f["user-model"]} is also being compared. Pick another --user-model or pass --allow-same-user-model.`);
  }
  const envCap = z.coerce.number().positive().optional().parse(process.env.MAX_RUN_COST_USD || undefined);
  const maxCostUsd = f["max-cost"] ?? envCap ?? DEFAULT_MAX_COST_USD;
  if (f.mode !== "replay") console.log(`Mode ${f.mode}: ${f.models.join(", ")} x ${scenarios.length} scenarios x ${f.trials} trials, cost cap $${maxCostUsd.toFixed(2)}`);

  const r = await runEval({
    scenarios,
    models: f.models,
    trials: f.trials,
    mode: f.mode,
    userModel: needsUser ? f["user-model"] : undefined,
    concurrency: f.concurrency,
    maxCostUsd,
    outDir: f.out,
  });
  console.log(readmeTable(r.summary));
  for (const n of r.summary.notes) console.log(`note: ${n}`);
  console.log(`\nWrote ${join(r.outDir, "runs.jsonl")} and summary.json. Spent $${r.summary.cost.spent_usd.toFixed(4)}.`);
  return exitCode(r.summary.cost.cap_hit, r.records);
}

export function exitCode(capHit: boolean, records: { status: string }[]): number {
  if (capHit) return 2;
  return records.some((x) => x.status === "error") ? 1 : 0;
}

const MetaSchema = z.object({ run_id: z.string(), mode: z.string(), trials: z.number(), prompt_hash: z.string(), harness_version: z.string(), user_model: z.string().nullable(), cost: z.object({ cap_usd: z.number(), spent_usd: z.number() }) });

export function loadRun(dir: string) {
  const records = readFileSync(join(dir, "runs.jsonl"), "utf8").split("\n").filter(Boolean).map((l, i) => {
    const parsed = RunRecordSchema.safeParse(JSON.parse(l));
    if (!parsed.success) throw new Error(`${dir}/runs.jsonl line ${i + 1}: ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  });
  const meta = MetaSchema.parse(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")));
  const summary = aggregate(records, { runId: meta.run_id, mode: meta.mode, trials: meta.trials, cap: meta.cost.cap_usd, spent: meta.cost.spent_usd, promptHash: meta.prompt_hash, harnessVersion: meta.harness_version, userModel: meta.user_model });
  return { records, summary };
}

function report(f: { in: string; readme: boolean }): number {
  if (!existsSync(join(f.in, "runs.jsonl"))) throw new Error(`No runs.jsonl in ${f.in}`);
  const { records, summary } = loadRun(f.in);
  if (f.readme) {
    console.log(readmeTable(summary));
    return 0;
  }
  writeFileSync(join(f.in, "report.md"), renderMarkdown(summary, records));
  writeFileSync(join(f.in, "report.html"), renderHtml(summary, records));
  console.log(`Wrote ${join(f.in, "report.md")} and ${join(f.in, "report.html")}`);
  return 0;
}

function validate(selector?: string): number {
  const scenarios = selectScenarios(loadScenarios(), selector);
  let bad = 0;
  for (const s of scenarios) {
    for (const p of validateScenario(s)) {
      console.error(`${s.id}: ${p}`);
      bad++;
    }
  }
  console.log(`${scenarios.length} scenarios checked, ${bad} problems`);
  return bad ? 1 : 0;
}

function list(): number {
  for (const s of loadScenarios()) console.log(`${s.id.padEnd(48)} ${s.category.padEnd(12)} ${s.user.mode}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}
