import { err } from "../backend/store.js";
import type { ToolError } from "../backend/types.js";

export type Fault = { tool: string; mode: "error" | "timeout"; times: number };

// Simulated, never slept: the number only shows up in the tool log.
export const TOOL_LATENCY_MS = 40;
export const TOOL_TIMEOUT_MS = 10_000;

// Returns a function that, per call of a tool, says whether a fault fires. Faults hit the first `times` calls only.
export function createFaultInjector(faults: Fault[]) {
  const calls = new Map<string, number>();
  return (tool: string): { result: ToolError; latency_ms: number } | null => {
    const n = (calls.get(tool) ?? 0) + 1;
    calls.set(tool, n);
    const fault = faults.find((f) => f.tool === tool);
    if (!fault || n > fault.times) return null;
    return fault.mode === "timeout"
      ? { result: err("TIMEOUT", `${tool} timed out after ${TOOL_TIMEOUT_MS} ms`), latency_ms: TOOL_TIMEOUT_MS }
      : { result: err("UPSTREAM_ERROR", `${tool} failed: upstream service error`), latency_ms: TOOL_LATENCY_MS };
  };
}
