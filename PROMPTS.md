# Milestone prompts

Paste these into Claude Code one at a time, in order, each in a fresh session from the repo root. Each one assumes the previous milestone is committed. `CLAUDE.md` and `SRS.md` apply to all of them.

---

## M0: Scaffold and tooling

```text
Read CLAUDE.md and SRS.md (sections 12, 13, 14, 15). Do milestone M0 only.

Goal: a working TypeScript project skeleton with pinned dependencies and a passing check.

Do:
- npm install exact versions of: ai, @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/groq, zod, yaml (deps) and typescript, tsx, vitest, @types/node (dev). Use --save-exact. Check that the AI SDK version you pick has wrapLanguageModel middleware and a mock language model in ai/test; note the version in docs/decisions.md.
- Keep the existing package.json fields; fill in scripts so that `npm run check` runs typecheck and vitest, and `npm run eval -- <cmd>` runs src/cli.ts.
- Create src/cli.ts with node:util parseArgs that prints usage for the commands in SRS section 9 and exits 0 on --help. Commands can print "not implemented" for now.
- Add tests/smoke.test.ts that imports cli usage text and asserts it lists run, report, validate, list.
- Add docs/decisions.md with 3 to 5 lines: stack choice (link SRS 12) and pinned versions.

Files: package.json, package-lock.json, src/cli.ts, tests/smoke.test.ts, docs/decisions.md.

Acceptance checks (run them and show output):
- npm ci && npm run check
- npx tsx src/cli.ts --help
- grep -rnP "[\x{2013}\x{2014}]" . --exclude-dir=.git --exclude-dir=node_modules   (prints nothing)

Commit as described in CLAUDE.md, then stop and summarise when done.
```

---

## M1: Fake backend, tools, unit tests

```text
Read CLAUDE.md and SRS.md (sections 5 FR-1 to FR-7, 7.1, 7.3, 11, 13). Do milestone M1 only.

Goal: a deterministic in-memory e-commerce backend and the agent tools over it, fully unit tested. No LLM code yet.

Do:
- src/backend/types.ts: Customer, Order, OrderItem, Address, Refund, Handoff, AddressChange, Snapshot (shape in SRS 7.1). Money in integer cents.
- src/backend/seed.ts: a small seeded PRNG (mulberry32 or similar, about 10 lines) and createBaseData(seed) producing about 20 customers and 60 orders across statuses pending, shipped, delivered, cancelled, with dates relative to the clock.
- src/backend/store.ts: createBackend({ seed, fixtures, clock }) that merges fixtures over base data by id, and exposes the operations in FR-3 plus snapshot().
- src/backend/rules.ts: refund window (more than 30 days after delivered_at is expired; exactly 30 days is allowed), shipped checks, double refund. Pure functions.
- src/tools/index.ts: the 7 tools from FR-3 with zod input schemas, in a provider neutral shape { name, description, inputSchema, execute } that M2 will adapt to the AI SDK. Errors returned as { error: { code, message } } (FR-5). handoff_to_human sets a flag the conversation loop can read.
- src/tools/faults.ts: wraps tools per FR-6. Timeouts are simulated: record latency, do not sleep.
- Every tool call appends to a tool log (FR-7).

Tests (tests/backend.test.ts, tests/tools.test.ts, tests/faults.test.ts):
- same seed and fixtures give deep-equal snapshots; different seeds differ
- fixture override by id works
- refund at day 30 succeeds, day 31 returns REFUND_WINDOW_EXPIRED; NOT_DELIVERED; ALREADY_REFUNDED
- change_shipping_address and cancel_order return ALREADY_SHIPPED after shipping
- each tool rejects bad args via zod with a clear error result, not a throw
- fault error and timeout apply to the first N calls only, then the tool works

Acceptance checks: npm run check; the dash grep prints nothing.

Commit, then stop and summarise when done.
```

---

## M2: Agent loop and provider abstraction

```text
Read CLAUDE.md and SRS.md (FR-8 to FR-14, section 11). Do milestone M2 only.

Goal: one agent loop that runs any registered model with the M1 tools, with usage, latency and cost captured.

Do:
- src/agent/system-prompt.md: the policies in FR-9, written plainly. Short (under 40 lines). No per-model variants.
- src/providers/registry.ts: getModel("provider:model") for openai, anthropic, groq using the AI SDK providers. Look up current model ids in each provider's docs and pick one fast, cheap tool-calling model per provider (for example gpt-4.1-mini, claude-haiku-4-5, llama-3.3-70b-versatile, but verify they exist today). Missing key gives a clear error naming the env var.
- src/providers/pricing.ts: USD per 1M input, cached input and output tokens for each registered model, with source URL and the date checked as a comment. Look prices up on the official pricing pages; do not guess. costUsd(model, usage) per SRS 8.7, returns null for unknown models.
- src/agent/loop.ts: runAgentTurn(history, tools, model, opts) per FR-8, using generateText with tools and a step limit (max_steps_per_turn, default 8), temperature 0. Returns new messages, tool log entries, usage per step, latency per step, and whether handoff happened. Tool errors go back to the model (FR-5).
- Keep the loop under about 120 lines.

Tests (tests/agent-loop.test.ts) with the AI SDK mock language model, no network:
- model calls get_order, receives result, then answers: history and tool log are correct
- tool error is passed back and the model can recover
- step limit stops a model that calls tools forever
- usage and cost are summed correctly
- tests/live-smoke.test.ts: one short real call per provider, skipped when its key is missing (use it.skipIf)

Acceptance checks: npm run check (with no keys set, live tests skip); the dash grep prints nothing. If keys are present in .env, run the live smoke test once and report the result, keeping total spend under $0.05.

Commit, then stop and summarise when done.
```

---

## M3: Scenarios and simulated user

```text
Read CLAUDE.md and SRS.md (FR-15 to FR-20, sections 7.1 and 7.3) and scenarios/policy-refund-past-30-days.yaml. Do milestone M3 only.

Goal: the full scenario set and the conversation loop that drives the agent with a simulated customer.

Do:
- src/scenarios/schema.ts: zod schema exactly matching SRS 7.1. src/scenarios/loader.ts: load and validate all YAML in scenarios/, error messages include the file name and zod path. src/scenarios/validate.ts: the cross checks in FR-20.
- src/conversation.ts: runConversation(scenario, agentModel, userModel?) that alternates user and agent turns per FR-15 and FR-16, ends on script end, handoff, [DONE] from the LLM user, or max_turns, and returns transcript, tool log, usage, latency, ended_by and the final snapshot.
- LLM user: short prompt built from persona, goal and known_facts; tells it to reply as the customer only, never as the agent, and to output [DONE] when the goal is met or clearly refused.
- Write the scenarios: 40 to 45 YAML files meeting every minimum in SRS 7.3, at least 5 with user.mode: llm. Name files <category>-<short-name>.yaml. Each must have precise final_state assertions and the right required, forbidden and allowed tools. Make the hard ones actually hard: injections hidden in plausible text, ambiguity that needs a clarifying question, faults that need a retry or a handoff. Keep the existing example file.
- Hook `validate` and `list` into the CLI.

Tests:
- schema accepts the example and rejects 4 broken variants (missing id, bad category, scripted with no turns, unknown tool name)
- conversation loop with a mock agent model and scripted user ends correctly on handoff, script end and max_turns
- LLM user mode with a mock user model ends on [DONE]
- a test that loads every file in scenarios/ and checks category minimums

Acceptance checks: npm run check; npx tsx src/cli.ts validate (exit 0); npx tsx src/cli.ts list; the dash grep prints nothing.

Commit, then stop and summarise when done (include the count per category).
```

---

## M4: Scorers, run recorder, cassettes, cost cap

```text
Read CLAUDE.md and SRS.md (FR-21 to FR-23, FR-25, sections 7.2, 8, 11, NFR-1 to NFR-4). Do milestone M4 only.

Goal: every run is scored with the exact SRS formulas, recorded to JSONL, and model calls can be recorded and replayed.

Do:
- src/scoring/result-schema.ts: zod schema for SRS 7.2.
- src/scoring/scorers.ts: task_success, tool_accuracy (subset arg matching with the normalisation in 8.2, one call per required entry), policy, handoff_correct, unnecessary_calls, overall, pass. Each returns its value plus human readable failure reasons.
- src/providers/cassette.ts: AI SDK middleware via wrapLanguageModel. Hash the normalised call options with sha256 (stable key order, no headers, no keys). Modes live, record, replay, auto (FR-22). Store recorded latency. Replay miss throws an error naming the scenario id and hash.
- src/runner.ts: scenario x model x trial with bounded concurrency, fresh backend per run, cost meter checked before every model call against MAX_RUN_COST_USD or --max-cost (FR-23), writes results/<run_id>/runs.jsonl and summary.json.
- src/scoring/aggregate.ts: per model pass rate, pass^k, mean overall, policy rate, handoff rate, mean turns, mean tool calls, p50 and p95 step latency, cost per scenario, total cost, plus per category pass rate.

Tests:
- one test per scorer formula with hand-built transcripts and snapshots, including edge cases (empty required_tools, duplicate calls, retry after error not counted)
- record with a mock model then replay gives identical runs.jsonl except timestamps (NFR-1)
- replay miss fails with a clear message
- cost cap: mock model with fixed usage and a tiny cap stops the run and marks runs aborted: "cost_cap"
- secret scan: no file under cassettes/ contains sk-, gsk_, Bearer or x-api-key (NFR-2)

Acceptance checks: npm run check; the dash grep prints nothing.

Commit, then stop and summarise when done.
```

---

## M5: CLI, report, real model comparison

```text
Read CLAUDE.md and SRS.md (sections 9 and 10, M5 in section 15). Do milestone M5 only.

Goal: the full CLI and report, then one real comparison run across 3 providers, recorded to cassettes.

Do:
- Finish src/cli.ts: run, report, validate, list with every flag in SRS 9 and the exit codes listed there.
- src/report/markdown.ts and src/report/html.ts per SRS 10. HTML is one static file, inline CSS, <details> for transcripts, no external requests. report --readme prints only the results table.
- Tests: report from a small fixture runs.jsonl matches an inline snapshot; CLI exit codes for a replay miss and a cost cap stop.
- Before any paid run, STOP and tell me: models (exact ids), scenario count, trials, estimated cost from a 3 scenario pilot, and the MAX_RUN_COST_USD value. Wait for my go-ahead.
- After approval: run with --mode record over all scenarios with 3 models from 3 providers (trials 1 unless I say otherwise). Then run the same command with --mode replay and confirm identical scores.
- Generate report.md and report.html. Copy the final summary.json and report.md to docs/results/<date>/ so they are committed (results/ itself stays gitignored). Commit the cassettes.
- Write docs/findings.md: 5 to 10 concrete observations taken from the failures section (which scenarios each model failed and why, with scenario ids). Only things visible in the transcripts.

Acceptance checks: npm run check; replay run exits 0 with no keys set (unset them in the shell for this check); the dash grep prints nothing; actual total spend reported from summary.json.

Commit, then stop and summarise when done (include the results table and total spend).
```

---

## M6: README with real results, polish, CI

```text
Read CLAUDE.md, SRS.md (M6), docs/findings.md and docs/results/. Do milestone M6 only.

Goal: a README a hiring manager can read in 2 minutes and trust, and CI that proves it runs without keys.

Do:
- README.md, in the style of a short engineering write-up:
  1. One paragraph: what it is and what it measures.
  2. Results table pasted exactly from `npx tsx src/cli.ts report --in <the M5 run> --readme`, with the run date and exact model ids. Do not edit any number.
  3. "What I learned": 3 to 5 bullets drawn only from docs/findings.md (real scenario ids, real failures).
  4. How it works: the mermaid diagram from SRS 11 and 5 lines on scoring, with a link to SRS 8.
  5. Run it: npm ci, npm test, replay command, record command (needs keys, cost cap).
  6. Add a scenario: a short YAML example and the validate command.
- .github/workflows/ci.yml: on push and pull_request, Node 22, npm ci, npm run check, validate, full replay run of the committed cassettes. No secrets referenced anywhere in the workflow.
- Run the workflow steps locally in a shell with no API keys set to confirm they pass.
- Polish: remove dead code, check no file is over 300 lines, src/ total under about 2,500 lines (report wc -l).
- Add a LICENSE (MIT, Farhaan Khan, 2026).

Acceptance checks: every CI step passes locally with keys unset; every number in README.md appears in docs/results/<date>/summary.json or report.md; the dash grep prints nothing.

Commit. Do not push. Stop and summarise when done.
```

---

## Final review prompt

```text
Read CLAUDE.md and SRS.md. Audit this repo before it goes public. Do not add features. Report findings first, then fix only clear violations and commit the fixes.

Check:
1. Dashes: grep -rnP "[\x{2013}\x{2014}]" . --exclude-dir=.git --exclude-dir=node_modules must print nothing. Also check commit messages: git log --format=%B | grep -nP "[\x{2013}\x{2014}]".
2. Secrets: grep for sk-, sk-ant-, gsk_, AIza, Bearer, x-api-key, and anything that looks like a key in all tracked files and in git history (git log -p). Confirm .env is not tracked and .env.example has empty values.
3. Commits: every commit authored by Farhaan Khan <farhaan.khan2022@vitstudent.ac.in> (git log --format="%an <%ae>" | sort -u), and no Co-Authored-By or "Generated with" lines (git log --format=%B | grep -niE "co-authored|generated with").
4. Invented numbers: for every number in README.md and docs/findings.md, find it in docs/results/*/summary.json or report.md. List any that cannot be traced. Re-run the replay and confirm the README table matches `report --readme` exactly.
5. README accuracy: every command in README runs as written on a clean clone with no keys; model ids and dates match the results; links resolve.
6. Buzzwords: grep docs and README for leverage, seamless, robust, cutting-edge, game-changer, delve, unlock, empower, revolutionize, state-of-the-art (ignore the list in CLAUDE.md itself).
7. Spec match: walk SRS FR-1 to FR-25 and NFR-1 to NFR-8 and mark each done, partial or missing with a file reference.

Stop and summarise when done: a table of checks with pass or fail, what you fixed, and anything that needs Farhaan's decision.
```
