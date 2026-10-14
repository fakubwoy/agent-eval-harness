import { anthropic } from "@ai-sdk/anthropic";
import { groq } from "@ai-sdk/groq";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

// Model ids checked against provider docs on 2026-10-14 (see pricing.ts for the URLs).
export const DEFAULT_MODELS = ["openai:gpt-4.1-mini", "anthropic:claude-haiku-4-5", "groq:openai/gpt-oss-120b"];
export const DEFAULT_USER_MODEL = "anthropic:claude-haiku-5-5";

const PROVIDERS: Record<string, { env: string; create: (id: string) => LanguageModel }> = {
  openai: { env: "OPENAI_API_KEY", create: (id) => openai(id) },
  anthropic: { env: "ANTHROPIC_API_KEY", create: (id) => anthropic(id) },
  groq: { env: "GROQ_API_KEY", create: (id) => groq(id) },
};

export function parseSpec(spec: string): { provider: string; id: string } {
  const i = spec.indexOf(":");
  const provider = spec.slice(0, i);
  if (i < 1 || !PROVIDERS[provider] || i === spec.length - 1) {
    throw new Error(`Bad model "${spec}": expected provider:model with provider one of ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return { provider, id: spec.slice(i + 1) };
}

export function keyEnv(spec: string): string {
  return PROVIDERS[parseSpec(spec).provider]!.env;
}

export function hasKey(spec: string): boolean {
  return Boolean(process.env[keyEnv(spec)]);
}

// Keys are only needed when a call actually goes to the provider, so replay works without them.
export function getModel(spec: string, { requireKey = false } = {}): LanguageModel {
  const { provider, id } = parseSpec(spec);
  if (requireKey && !hasKey(spec)) throw new Error(`Missing ${keyEnv(spec)} for ${spec}. Set it in .env or the environment.`);
  return PROVIDERS[provider]!.create(id);
}
