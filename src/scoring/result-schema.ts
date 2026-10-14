import { z } from "zod";

// SRS 7.2. Single source of truth for one line of runs.jsonl.
export const ScoresSchema = z.object({
  task_success: z.union([z.literal(0), z.literal(1)]),
  tool_accuracy: z.number().min(0).max(1),
  policy: z.union([z.literal(0), z.literal(1)]),
  handoff_correct: z.union([z.literal(0), z.literal(1)]),
  unnecessary_calls: z.number().int().min(0),
  overall: z.number().min(0).max(1),
  pass: z.boolean(),
});

export const RunRecordSchema = z.object({
  run_id: z.string(),
  scenario_id: z.string(),
  category: z.string(),
  model: z.string(),
  user_model: z.string().nullable(),
  trial: z.number().int().min(1),
  mode: z.enum(["live", "record", "replay", "auto"]),
  harness_version: z.string(),
  prompt_hash: z.string(),
  temperature: z.number(),
  status: z.enum(["completed", "aborted", "error"]),
  aborted: z.literal("cost_cap").nullable(),
  error: z.string().nullable(),
  ended_by: z.enum(["script_end", "handoff", "max_turns", "user_done", "error"]),
  scores: ScoresSchema,
  failures: z.array(z.string()),
  metrics: z.object({
    turns: z.number().int(),
    steps: z.number().int(),
    tool_calls: z.number().int(),
    tool_errors: z.number().int(),
    input_tokens: z.number().int(),
    cached_input_tokens: z.number().int(),
    output_tokens: z.number().int(),
    cost_usd: z.number().nullable(),
    user_cost_usd: z.number().nullable(),
    latency_ms_total: z.number(),
    latency_ms_per_step: z.array(z.number()),
  }),
  transcript: z.array(
    z.object({ role: z.enum(["user", "assistant", "tool"]), content: z.string(), tool_name: z.string().nullable(), args: z.unknown() }),
  ),
  tool_log: z.array(
    z.object({ step: z.number().int(), name: z.string(), args: z.unknown(), result: z.unknown(), error_code: z.string().nullable(), latency_ms: z.number() }),
  ),
  final_state: z.record(z.string(), z.unknown()),
});

export type Scores = z.infer<typeof ScoresSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;
