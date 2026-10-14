import type { LanguageModelUsage } from "ai";

// USD per 1M tokens. Checked 2026-10-14 on:
// OpenAI: https://developers.openai.com/api/docs/pricing (standard tier)
// Anthropic: https://platform.claude.com/docs/en/about-claude/pricing (cached input = "cache hits and refreshes")
// Groq: https://console.groq.com/docs/models (no separate cached input price listed, so it is billed as input here)
export type Price = { input: number; cached_input: number; output: number };

export const PRICING: Record<string, Price> = {
  "openai:gpt-4.1-mini": { input: 0.4, cached_input: 0.1, output: 1.6 },
  "openai:gpt-5-mini": { input: 0.25, cached_input: 0.025, output: 2.0 },
  "anthropic:claude-haiku-4-5": { input: 1.0, cached_input: 0.1, output: 5.0 },
  "anthropic:claude-haiku-5-5": { input: 0.1, cached_input: 0.01, output: 0.5 },
  "groq:openai/gpt-oss-120b": { input: 0.15, cached_input: 0.15, output: 0.6 },
  "groq:openai/gpt-oss-20b": { input: 0.075, cached_input: 0.075, output: 0.3 },
};

export type Usage = { input_tokens: number; cached_input_tokens: number; output_tokens: number };

export function toUsage(u: LanguageModelUsage | undefined): Usage {
  return {
    input_tokens: u?.inputTokens ?? 0,
    cached_input_tokens: u?.inputTokenDetails?.cacheReadTokens ?? 0,
    output_tokens: u?.outputTokens ?? 0,
  };
}

// SRS 8.7. Unknown model gives null, never zero.
export function costUsd(model: string, u: Usage, table: Record<string, Price> = PRICING): number | null {
  const p = table[model];
  if (!p) return null;
  return ((u.input_tokens - u.cached_input_tokens) * p.input + u.cached_input_tokens * p.cached_input + u.output_tokens * p.output) / 1e6;
}
