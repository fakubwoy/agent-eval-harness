import { z } from "zod";
import { CustomerSchema, DEFAULT_CLOCK, OrderSchema } from "../backend/types.js";
import { TOOL_NAMES } from "../tools/index.js";

export const CATEGORIES = ["happy_path", "missing_info", "ambiguous", "policy", "injection", "tool_fault", "multi_turn", "handoff", "identity"] as const;

const ToolNameSchema = z.enum(TOOL_NAMES);
const ToolExpectSchema = z.object({ name: ToolNameSchema, args: z.record(z.string(), z.unknown()).optional() });

const UserSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("scripted"), turns: z.array(z.string().min(1)).min(1) }),
  z.object({
    mode: z.literal("llm"),
    persona: z.string().min(1),
    goal: z.string().min(1),
    known_facts: z.record(z.string(), z.string()).default({}),
  }),
]);

export const ScenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be kebab-case"),
  title: z.string().min(1),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string()).default([]),
  seed: z.number().int().default(42),
  clock: z.iso.datetime().default(DEFAULT_CLOCK),
  fixtures: z.object({ customers: z.array(CustomerSchema).optional(), orders: z.array(OrderSchema).optional() }).default({}),
  faults: z.array(z.object({ tool: ToolNameSchema, mode: z.enum(["error", "timeout"]), times: z.number().int().min(1) })).default([]),
  user: UserSchema,
  expect: z.object({
    final_state: z
      .array(z.object({ path: z.string().min(1), equals: z.unknown().optional(), length: z.number().int().min(0).optional(), exists: z.boolean().optional() }))
      .default([]),
    required_tools: z.array(ToolExpectSchema).default([]),
    forbidden_tools: z.array(ToolExpectSchema).default([]),
    allowed_tools: z.array(ToolNameSchema).default([]),
    handoff: z.enum(["required", "forbidden", "optional"]),
    must_not_say: z.array(z.string()).default([]),
    must_say: z.array(z.string()).default([]),
  }),
  limits: z.object({ max_turns: z.number().int().min(1).default(8), max_steps_per_turn: z.number().int().min(1).default(8) }).default({ max_turns: 8, max_steps_per_turn: 8 }),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_MINIMUMS: Record<Category, number> = {
  happy_path: 6,
  missing_info: 4,
  ambiguous: 4,
  policy: 6,
  injection: 5,
  tool_fault: 4,
  multi_turn: 4,
  handoff: 3,
  identity: 3,
};
