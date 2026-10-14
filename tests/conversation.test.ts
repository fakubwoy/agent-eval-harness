import { describe, expect, it } from "vitest";
import { runConversation, userPrompt } from "../src/conversation.js";
import { ScenarioSchema } from "../src/scenarios/schema.js";
import { FIXTURES } from "./fixtures.js";
import { scriptedModel } from "./mock.js";

const scenario = (user: unknown, max_turns = 8) =>
  ScenarioSchema.parse({ id: "t", title: "t", category: "happy_path", fixtures: FIXTURES, user, expect: { handoff: "optional" }, limits: { max_turns } });

describe("runConversation", () => {
  it("ends on script end", async () => {
    const r = await runConversation(scenario({ mode: "scripted", turns: ["hi", "bye"] }), { agent: scriptedModel([{ text: "Hello" }]) });
    expect(r.ended_by).toBe("script_end");
    expect(r.turns).toBe(2);
    expect(r.transcript.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("tells the agent the scenario clock", async () => {
    const agent = scriptedModel([{ text: "Hello" }]);
    await runConversation(scenario({ mode: "scripted", turns: ["hi"] }), { agent });
    const system = JSON.stringify(agent.doGenerateCalls[0]!.prompt[0]);
    expect(system).toContain("The current date and time is 2026-06-15T12:00:00Z");
    expect(system).not.toContain("{{now}}");
  });

  it("ends on handoff and records the tool call in the transcript", async () => {
    const agent = scriptedModel([{ text: "Let me check." , calls: [["get_order", { order_id: "ORD-30" }]] }, { text: "Done." }, { calls: [["handoff_to_human", { reason: "asked", summary: "s" }]] }]);
    const r = await runConversation(scenario({ mode: "scripted", turns: ["status of ORD-30", "human please", "never sent"] }), { agent });
    expect(r.ended_by).toBe("handoff");
    expect(r.turns).toBe(2);
    expect(r.final_state.handoffs).toHaveLength(1);
    expect(r.transcript.find((t) => t.role === "tool")).toMatchObject({ tool_name: "get_order", args: { order_id: "ORD-30" } });
    expect(r.tool_log.map((e) => e.step)).toEqual([1, 3]);
  });

  it("ends on max_turns", async () => {
    const r = await runConversation(scenario({ mode: "scripted", turns: ["a", "b", "c", "d"] }, 2), { agent: scriptedModel([{ text: "ok" }]) });
    expect(r.ended_by).toBe("max_turns");
    expect(r.turns).toBe(2);
  });

  it("LLM customer talks until it says [DONE]", async () => {
    let n = 0;
    const user = scriptedModel(() => ({ text: ["Where is ORD-30?", "Thanks", "[DONE]"][n++]! }));
    const s = scenario({ mode: "llm", persona: "busy", goal: "find out the status", known_facts: { order_id: "ORD-30" } });
    const r = await runConversation(s, { agent: scriptedModel([{ text: "It was delivered." }]), user });
    expect(r.ended_by).toBe("user_done");
    expect(r.turns).toBe(2);
    expect(r.user_steps).toHaveLength(3);
    // the customer model sees the agent's replies as the other side of the chat
    const lastPrompt = user.doGenerateCalls[2]!.prompt;
    expect(lastPrompt.at(-1)).toMatchObject({ role: "user" });
    expect(JSON.stringify(lastPrompt)).toContain("It was delivered.");
    expect(userPrompt(s.user as never)).toContain("ORD-30");
  });

  it("returns errors as ended_by error with partial results", async () => {
    const s = scenario({ mode: "llm", persona: "p", goal: "g" });
    const r = await runConversation(s, { agent: scriptedModel([{ text: "x" }]) });
    expect(r.ended_by).toBe("error");
    expect(r.error).toMatch(/no user model/);
  });
});
