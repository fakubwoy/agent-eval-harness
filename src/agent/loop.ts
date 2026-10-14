import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { generateText, jsonSchema, stepCountIs, tool, type JSONSchema7, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { toUsage, type Usage } from "../providers/pricing.js";
import type { Toolbox } from "../tools/index.js";

export const SYSTEM_PROMPT = readFileSync(new URL("./system-prompt.md", import.meta.url), "utf8");
export const DEFAULT_MAX_STEPS = 8;

// The backend runs on a frozen scenario clock, so the agent must be told that date rather than guess today's.
export function systemPrompt(clock: string): string {
  return SYSTEM_PROMPT.replace("{{now}}", clock);
}
export const TEMPERATURE = 0;
// Free tier rate limits (Groq: 8000 tokens per minute) need the SDK backoff to cover about a minute.
export const MAX_RETRIES = 6;

const toolSchemas = (box: Pick<Toolbox, "defs">) =>
  box.defs.map((d) => ({ name: d.name, description: d.description, schema: z.toJSONSchema(d.inputSchema) as JSONSchema7 }));

export function promptHash(box: Pick<Toolbox, "defs">, system = SYSTEM_PROMPT): string {
  return createHash("sha256").update(system).update(JSON.stringify(toolSchemas(box))).digest("hex");
}

// No SDK side validation: the toolbox parses with zod so bad args become an INVALID_ARGS result in the log.
function sdkTools(box: Toolbox, step: () => number): ToolSet {
  return Object.fromEntries(
    toolSchemas(box).map((t) => [
      t.name,
      tool({ description: t.description, inputSchema: jsonSchema<unknown>(t.schema), execute: async (args: unknown) => box.call(t.name, args, step()) }),
    ]),
  );
}

export type StepStats = Usage & { latency_ms: number };

export type TurnResult = {
  messages: ModelMessage[];
  steps: StepStats[];
  text: string;
  handed_off: boolean;
  hit_step_limit: boolean;
};

// The cassette middleware reports latency (recorded or measured); plain models fall back to wall clock.
function latencyOf(meta: unknown, fallback: number): number {
  const ms = (meta as { harness?: { latency_ms?: unknown } } | undefined)?.harness?.latency_ms;
  return typeof ms === "number" ? ms : fallback;
}

export async function runAgentTurn(
  history: ModelMessage[],
  toolbox: Toolbox,
  model: LanguageModel,
  opts: { maxSteps?: number; stepOffset?: number; system?: string } = {},
): Promise<TurnResult> {
  const { maxSteps = DEFAULT_MAX_STEPS, stepOffset = 0, system = SYSTEM_PROMPT } = opts;
  const messages: ModelMessage[] = [];
  const steps: StepStats[] = [];
  const tools = sdkTools(toolbox, () => stepOffset + steps.length + 1);

  while (steps.length < maxSteps) {
    const started = performance.now();
    const r = await generateText({
      model,
      system,
      messages: [...history, ...messages],
      tools,
      temperature: TEMPERATURE,
      stopWhen: stepCountIs(1),
      maxRetries: MAX_RETRIES,
    });
    steps.push({ ...toUsage(r.usage), latency_ms: latencyOf(r.providerMetadata, Math.round(performance.now() - started)) });
    messages.push(...r.response.messages);
    if (toolbox.handedOff()) return { messages, steps, text: r.text, handed_off: true, hit_step_limit: false };
    if (r.toolCalls.length === 0) return { messages, steps, text: r.text, handed_off: false, hit_step_limit: false };
  }
  return { messages, steps, text: "", handed_off: false, hit_step_limit: true };
}
