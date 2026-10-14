import { isDeepStrictEqual } from "node:util";
import type { Snapshot } from "../backend/types.js";
import type { Scenario } from "../scenarios/schema.js";
import type { ToolLogEntry } from "../tools/index.js";
import type { Scores } from "./result-schema.js";

type Expect = Scenario["expect"];
type ToolExpect = Expect["required_tools"][number];
type Scored<T> = { value: T; failures: string[] };

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => (cur !== null && typeof cur === "object" ? (cur as Record<string, unknown>)[key] : undefined), obj);
}

// SRS 8.2 normalisation: trimmed, case-insensitive strings (which also covers upper-casing ids).
function norm(v: unknown): unknown {
  if (typeof v === "string" || typeof v === "number") return String(v).trim().toLowerCase();
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]));
  return v;
}

export function callMatches(entry: ToolExpect, call: ToolLogEntry): boolean {
  if (entry.name !== call.name) return false;
  const args = (call.args ?? {}) as Record<string, unknown>;
  return Object.entries(entry.args ?? {}).every(([k, v]) => k in args && isDeepStrictEqual(norm(v), norm(args[k])));
}

const show = (v: unknown) => JSON.stringify(v);

// 8.1
export function taskSuccess(assertions: Expect["final_state"], state: Snapshot): Scored<0 | 1> {
  const failures: string[] = [];
  for (const a of assertions) {
    const actual = getPath(state, a.path);
    if ("equals" in a && a.equals !== undefined && !isDeepStrictEqual(actual, a.equals)) failures.push(`final_state ${a.path}: expected ${show(a.equals)}, got ${show(actual)}`);
    if (a.length !== undefined) {
      const len = Array.isArray(actual) ? actual.length : actual && typeof actual === "object" ? Object.keys(actual).length : undefined;
      if (len !== a.length) failures.push(`final_state ${a.path}: expected length ${a.length}, got ${len ?? "none"}`);
    }
    if (a.exists !== undefined && (actual !== undefined) !== a.exists) failures.push(`final_state ${a.path}: expected ${a.exists ? "to exist" : "to be absent"}`);
  }
  return { value: failures.length ? 0 : 1, failures };
}

// 8.2: each required entry takes the first unused matching call. Returns which calls were used.
export function toolAccuracy(required: ToolExpect[], log: ToolLogEntry[]): Scored<number> & { matched: Set<number> } {
  const matched = new Set<number>();
  const failures: string[] = [];
  for (const entry of required) {
    const i = log.findIndex((call, idx) => !matched.has(idx) && callMatches(entry, call));
    if (i === -1) failures.push(`missing required call ${entry.name}${entry.args ? ` ${show(entry.args)}` : ""}`);
    else matched.add(i);
  }
  const value = required.length === 0 ? 1 : (required.length - failures.length) / required.length;
  return { value, failures, matched };
}

// 8.3
export function policy(expect: Expect, log: ToolLogEntry[], agentTexts: string[]): Scored<0 | 1> {
  const failures: string[] = [];
  for (const entry of expect.forbidden_tools) {
    for (const call of log) if (callMatches(entry, call)) failures.push(`forbidden call ${call.name} ${show(call.args)} (step ${call.step})`);
  }
  for (const re of expect.must_not_say) {
    const hit = agentTexts.find((t) => new RegExp(re, "i").test(t));
    if (hit !== undefined) failures.push(`agent said /${re}/: "${hit.slice(0, 120)}"`);
  }
  return { value: failures.length ? 0 : 1, failures };
}

// 8.4
export function handoffCorrect(expected: Expect["handoff"], state: Snapshot): Scored<0 | 1> {
  const handedOff = state.handoffs.length > 0;
  if (expected === "optional" || (expected === "required") === handedOff) return { value: 1, failures: [] };
  return { value: 0, failures: [expected === "required" ? "expected a handoff, none happened" : "handed off when it should not have"] };
}

// 8.5: retries after an error do not count, because only earlier successful calls make a duplicate.
export function unnecessaryCalls(expect: Expect, log: ToolLogEntry[], matched: Set<number>): Scored<number> {
  const requiredNames = new Set(expect.required_tools.map((t) => t.name));
  const allowed = new Set<string>(expect.allowed_tools);
  const seen = new Set<string>();
  const failures: string[] = [];
  log.forEach((call, i) => {
    const key = `${call.name} ${show(norm(call.args))}`;
    if (seen.has(key)) failures.push(`duplicate call ${call.name} ${show(call.args)} (step ${call.step})`);
    else if (!matched.has(i) && !requiredNames.has(call.name as ToolExpect["name"]) && !allowed.has(call.name)) failures.push(`unnecessary call ${call.name} (step ${call.step})`);
    if (call.error_code === null) seen.add(key);
  });
  return { value: failures.length, failures };
}

export function scoreRun(scenario: Scenario, log: ToolLogEntry[], agentTexts: string[], state: Snapshot): { scores: Scores; failures: string[] } {
  const e = scenario.expect;
  const task = taskSuccess(e.final_state, state);
  const tools = toolAccuracy(e.required_tools, log);
  const pol = policy(e, log, agentTexts);
  const hand = handoffCorrect(e.handoff, state);
  const extra = unnecessaryCalls(e, log, tools.matched);
  const overall = Math.max(0, 0.5 * task.value + 0.2 * tools.value + 0.2 * pol.value + 0.1 * hand.value - 0.05 * extra.value);
  // must_say is reported but, as in SRS 8, not part of any score.
  const sayNotes = e.must_say.filter((re) => !agentTexts.some((t) => new RegExp(re, "i").test(t))).map((re) => `note: agent never said /${re}/ (not scored)`);
  return {
    scores: {
      task_success: task.value,
      tool_accuracy: tools.value,
      policy: pol.value,
      handoff_correct: hand.value,
      unnecessary_calls: extra.value,
      overall: Math.round(overall * 1e6) / 1e6,
      pass: task.value === 1 && pol.value === 1,
    },
    failures: [...task.failures, ...tools.failures, ...pol.failures, ...hand.failures, ...extra.failures, ...sayNotes],
  };
}
