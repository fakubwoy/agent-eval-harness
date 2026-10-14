import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { ScenarioSchema, type Scenario } from "./schema.js";

export const SCENARIO_DIR = "scenarios";

// Collects every problem across all files so one validate run shows them all.
export function loadScenarios(dir = SCENARIO_DIR): Scenario[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort();
  const errors: string[] = [];
  const scenarios: Scenario[] = [];
  for (const file of files) {
    let raw: unknown;
    try {
      raw = parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      errors.push(`${file}: YAML: ${(e as Error).message}`);
      continue;
    }
    const parsed = ScenarioSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${file}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      continue;
    }
    if (parsed.data.id !== basename(file, ".yaml")) errors.push(`${file}: id: "${parsed.data.id}" must equal the file name`);
    else scenarios.push(parsed.data);
  }
  if (errors.length) throw new Error(`Invalid scenarios:\n${errors.join("\n")}`);
  return scenarios;
}

// Selector: comma separated ids, globs with *, or category:<name>. Empty means all.
export function selectScenarios(all: Scenario[], selector?: string): Scenario[] {
  if (!selector) return all;
  const parts = selector.split(",").map((s) => s.trim()).filter(Boolean);
  const matches = (s: Scenario, p: string) => {
    if (p.startsWith("category:")) return s.category === p.slice("category:".length);
    const re = new RegExp(`^${p.replace(/\.yaml$/, "").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    return re.test(s.id);
  };
  const picked = all.filter((s) => parts.some((p) => matches(s, p)));
  if (picked.length === 0) throw new Error(`No scenarios match "${selector}"`);
  return picked;
}
