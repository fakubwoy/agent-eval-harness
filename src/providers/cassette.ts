import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { APICallError, type LanguageModelMiddleware } from "ai";
import { z } from "zod";
import { parseSpec } from "./registry.js";
import type { Usage } from "./pricing.js";

export type CassetteMode = "live" | "record" | "replay" | "auto";
export const CASSETTE_DIR = "cassettes";

export class ReplayMissError extends Error {}
export class CostCapError extends Error {}
// The provider refused the model's own output (for example Groq rejecting a call to a tool that does not exist).
// That is the model failing, so it is recorded and replayed like any other response.
export class ProviderRejectedError extends Error {}

const UsageSchema = z.object({
  inputTokens: z.object({ total: z.number().optional(), noCache: z.number().optional(), cacheRead: z.number().optional(), cacheWrite: z.number().optional() }),
  outputTokens: z.object({ total: z.number().optional(), text: z.number().optional(), reasoning: z.number().optional() }),
});

const CassetteSchema = z.object({
  hash: z.string(),
  model: z.string(),
  scenario: z.string(),
  trial: z.number(),
  latency_ms: z.number(),
  request: z.object({ messages: z.number(), last: z.unknown() }),
  response: z
    .object({
      content: z.array(z.looseObject({ type: z.string() })),
      finishReason: z.object({ unified: z.enum(["stop", "length", "content-filter", "tool-calls", "error", "other"]), raw: z.string().optional() }),
      usage: UsageSchema,
    })
    .optional(),
  rejected: z.string().optional(),
});

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v;
}

type CallParams = Parameters<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>[0]["params"];

// Only what decides the model's answer goes in the key: no headers, keys, abort signals or provider options.
// `talksTo` is set for the simulated customer: its opening message is the same request whichever agent it faces,
// so without the agent in the key, runs of different agent models would share and overwrite that cassette.
export function requestHash(model: string, scenario: string, trial: number, p: CallParams, talksTo?: string): string {
  const { prompt, tools, toolChoice, temperature, maxOutputTokens, topP, topK, stopSequences, responseFormat, seed } = p;
  const key = { model, talksTo, scenario, trial, prompt, tools, toolChoice, temperature, maxOutputTokens, topP, topK, stopSequences, responseFormat, seed };
  return createHash("sha256").update(JSON.stringify(stable(key))).digest("hex");
}

export function cassettePath(dir: string, model: string, hash: string): string {
  const { provider, id } = parseSpec(model);
  return join(dir, provider, id.replace(/[^\w.-]/g, "_"), `${hash}.json`);
}

// Only rejections of what the model generated count; any other 400 is a harness bug and must stay an error.
export function isModelOutputRejection(e: unknown): boolean {
  if (!APICallError.isInstance(e) || e.statusCode !== 400) return false;
  return /tool_use_failed|tool call validation failed/i.test(`${e.message} ${e.responseBody ?? ""}`);
}

export type Meter = { check(): void; add(model: string, usage: Usage): void };

export function cassetteMiddleware(o: { model: string; mode: CassetteMode; trial: number; scenario: string; talksTo?: string; dir?: string; meter?: Meter }): LanguageModelMiddleware {
  const dir = o.dir ?? CASSETTE_DIR;
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, params }) => {
      const hash = requestHash(o.model, o.scenario, o.trial, params, o.talksTo);
      const file = cassettePath(dir, o.model, hash);
      if ((o.mode === "replay" || o.mode === "auto") && existsSync(file)) {
        const c = CassetteSchema.parse(JSON.parse(readFileSync(file, "utf8")));
        if (c.rejected !== undefined) throw new ProviderRejectedError(c.rejected);
        // Replayed calls report the recorded latency and cost nothing.
        return { ...(c.response as never as Awaited<ReturnType<typeof doGenerate>>), warnings: [], providerMetadata: { harness: { latency_ms: c.latency_ms, replayed: true } } };
      }
      if (o.mode === "replay") throw new ReplayMissError(`Replay miss: scenario ${o.scenario}, model ${o.model}, trial ${o.trial}, request hash ${hash} (no ${file})`);

      const save = (latency_ms: number, body: object) => {
        if (o.mode === "live") return;
        const request = { messages: params.prompt.length, last: params.prompt.at(-1) };
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ hash, model: o.model, scenario: o.scenario, trial: o.trial, latency_ms, request, ...body }, null, 2) + "\n");
      };
      o.meter?.check();
      const started = performance.now();
      let result: Awaited<ReturnType<typeof doGenerate>>;
      try {
        result = await doGenerate();
      } catch (e) {
        if (!isModelOutputRejection(e)) throw e;
        const message = `Provider rejected the model output: ${(e as Error).message}`;
        save(Math.round(performance.now() - started), { rejected: message });
        throw new ProviderRejectedError(message);
      }
      const latency_ms = Math.round(performance.now() - started);
      const u = result.usage;
      o.meter?.add(o.model, { input_tokens: u.inputTokens.total ?? 0, cached_input_tokens: u.inputTokens.cacheRead ?? 0, output_tokens: u.outputTokens.total ?? 0 });
      save(latency_ms, { response: { content: result.content, finishReason: result.finishReason, usage: { inputTokens: u.inputTokens, outputTokens: u.outputTokens } } });
      return { ...result, providerMetadata: { ...result.providerMetadata, harness: { latency_ms, replayed: false } } };
    },
  };
}
