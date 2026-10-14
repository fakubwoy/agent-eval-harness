import { generateText, type LanguageModel, type ModelMessage } from "ai";
import { MAX_RETRIES, runAgentTurn, systemPrompt, TEMPERATURE, type StepStats } from "./agent/loop.js";
import { createBackend } from "./backend/store.js";
import type { Snapshot } from "./backend/types.js";
import { ProviderRejectedError } from "./providers/cassette.js";
import { toUsage } from "./providers/pricing.js";
import type { Scenario } from "./scenarios/schema.js";
import { createToolbox, type ToolLogEntry } from "./tools/index.js";

export type TranscriptEntry = { role: "user" | "assistant" | "tool"; content: string; tool_name: string | null; args: unknown };
export type EndedBy = "script_end" | "handoff" | "max_turns" | "user_done" | "error";

export type ConversationResult = {
  transcript: TranscriptEntry[];
  tool_log: ToolLogEntry[];
  agent_steps: StepStats[];
  user_steps: StepStats[];
  turns: number;
  ended_by: EndedBy;
  final_state: Snapshot;
  error: string | null;
  // true when the error is the model's own fault (its output was rejected), so the run is scored, not discarded
  model_error: boolean;
};

const DONE = "[DONE]";

export function userPrompt(s: Extract<Scenario["user"], { mode: "llm" }>): string {
  const facts = Object.entries(s.known_facts).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- (none)";
  return `You are role-playing a customer in an online shop's support chat. You are the customer, never the support agent.

Persona: ${s.persona}
Goal: ${s.goal}
Facts you know (share them when asked or when they help reach your goal):
${facts}

Rules:
- Write only your next message as the customer. Keep it short and natural.
- Do not invent facts that are not listed. If asked for something you do not know, say so.
- When your goal is met, or the agent has clearly refused it or handed you to a human, reply with exactly ${DONE} and nothing else.`;
}

function textOf(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

// Flattens SDK messages into the result record's transcript: assistant text plus one entry per tool result.
export function toTranscript(messages: ModelMessage[]): TranscriptEntry[] {
  const args = new Map<string, unknown>();
  const out: TranscriptEntry[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      if (typeof m.content !== "string") for (const p of m.content) if (p.type === "tool-call") args.set(p.toolCallId, p.input);
      const text = textOf(m.content);
      if (text.trim()) out.push({ role: "assistant", content: text, tool_name: null, args: null });
    } else if (m.role === "tool") {
      for (const p of m.content) {
        if (p.type !== "tool-result") continue;
        const value = "value" in p.output ? p.output.value : p.output;
        out.push({ role: "tool", content: JSON.stringify(value), tool_name: p.toolName, args: args.get(p.toolCallId) ?? null });
      }
    }
  }
  return out;
}

export async function runConversation(
  scenario: Scenario,
  models: { agent: LanguageModel; user?: LanguageModel },
): Promise<ConversationResult> {
  const backend = createBackend({ seed: scenario.seed, fixtures: scenario.fixtures, clock: scenario.clock });
  const toolbox = createToolbox(backend, scenario.faults);
  const history: ModelMessage[] = [];
  const userView: ModelMessage[] = [{ role: "user", content: "(The support chat is open. Write your first message.)" }];
  const transcript: TranscriptEntry[] = [];
  const agent_steps: StepStats[] = [];
  const user_steps: StepStats[] = [];
  const { max_turns, max_steps_per_turn } = scenario.limits;
  const u = scenario.user;
  let turns = 0;
  let ended_by: EndedBy | null = null;
  let error: string | null = null;
  let model_error = false;

  async function nextUserMessage(): Promise<string | null> {
    if (u.mode === "scripted") return u.turns[turns] ?? null;
    if (!models.user) throw new Error(`Scenario ${scenario.id} uses an LLM customer but no user model was given`);
    const started = performance.now();
    const r = await generateText({ model: models.user, system: userPrompt(u), messages: userView, temperature: TEMPERATURE, maxRetries: MAX_RETRIES });
    const latency = (r.providerMetadata as { harness?: { latency_ms?: number } } | undefined)?.harness?.latency_ms;
    user_steps.push({ ...toUsage(r.usage), latency_ms: latency ?? Math.round(performance.now() - started) });
    return r.text.trim();
  }

  try {
    while (turns < max_turns) {
      const msg = await nextUserMessage();
      if (msg === null) {
        ended_by = "script_end";
        break;
      }
      if (msg.includes(DONE) || msg === "") {
        ended_by = "user_done";
        break;
      }
      turns++;
      history.push({ role: "user", content: msg });
      userView.push({ role: "assistant", content: msg });
      transcript.push({ role: "user", content: msg, tool_name: null, args: null });

      const r = await runAgentTurn(history, toolbox, models.agent, { maxSteps: max_steps_per_turn, stepOffset: agent_steps.length, system: systemPrompt(scenario.clock) });
      history.push(...r.messages);
      transcript.push(...toTranscript(r.messages));
      agent_steps.push(...r.steps);
      userView.push({ role: "user", content: r.text.trim() || "(the agent did not reply)" });
      if (r.handed_off) {
        ended_by = "handoff";
        break;
      }
    }
    ended_by ??= u.mode === "scripted" && turns >= u.turns.length ? "script_end" : "max_turns";
  } catch (e) {
    ended_by = "error";
    error = e instanceof Error ? e.message : String(e);
    model_error = e instanceof ProviderRejectedError;
  }

  return { transcript, tool_log: toolbox.log, agent_steps, user_steps, turns, ended_by, final_state: backend.snapshot(), error, model_error };
}
