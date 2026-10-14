import { MockLanguageModelV4 } from "ai/test";

export type Reply = { text?: string; calls?: [string, unknown][] };
export const USAGE = { inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };

// A model that plays back replies in order; the last reply repeats once the list runs out.
export function scriptedModel(replies: Reply[] | ((prompt: unknown[]) => Reply), modelId = "mock-model") {
  let n = 0;
  return new MockLanguageModelV4({
    provider: "mock",
    modelId,
    doGenerate: async (opts) => {
      const r = typeof replies === "function" ? replies(opts.prompt) : replies[Math.min(n, replies.length - 1)]!;
      n++;
      const content = [
        ...(r.text ? [{ type: "text" as const, text: r.text }] : []),
        ...(r.calls ?? []).map(([toolName, args], i) => ({ type: "tool-call" as const, toolCallId: `call-${n}-${i}`, toolName, input: JSON.stringify(args) })),
      ];
      const finish = r.calls?.length ? "tool-calls" : "stop";
      return { content, finishReason: { unified: finish, raw: finish }, usage: USAGE, warnings: [] };
    },
  });
}
