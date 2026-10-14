# Instructions for coding agents

This repo is a public portfolio project for Farhaan Khan. `SRS.md` is the spec: read it before any work and follow it. `PROMPTS.md` lists the milestones in order. Do one milestone per session and stop when its acceptance checks pass.

## Stack

- Node 22, TypeScript (strict), ES modules, run with `tsx`. No build step.
- Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/groq`), `zod`, `yaml`, `vitest`. Pin exact versions.
- Do not add other dependencies without a one-line reason in the commit message. No LangChain, no agent frameworks, no CLI frameworks (use `node:util` `parseArgs`), no lodash.

## Code conventions

- Keep code small and readable. Prefer plain functions and plain objects over classes. No file over 300 lines. If something can be 10 lines instead of 40, write 10.
- Parse every external input with zod: YAML scenarios, tool arguments, cassette files, CLI flags after parsing.
- Money is integer cents in the backend; USD floats only in cost reporting.
- The backend never reads the real clock or `Math.random`. Use the scenario clock and a seeded PRNG.
- Tool errors are returned to the model as data, never thrown out of the agent loop.
- Comments explain why, not what. No commented-out code.
- File and folder layout is fixed in SRS section 13. Ask before changing it.

## Tests

- Every milestone ships tests for what it adds. `npm run check` (typecheck plus vitest) must pass before you commit.
- Tests never call real APIs. Use the AI SDK mock model or cassettes in replay mode. Live smoke tests must skip when the key is missing.

## Secrets and money

- Never commit secrets. Keys come only from environment variables; `.env` is gitignored and `.env.example` lists the names. Never print keys in logs or errors.
- Cassettes store request and response bodies only, never headers.
- Any live or record run must respect `MAX_RUN_COST_USD` (default 2.00). Do not raise it on your own. Before a live run, tell Farhaan the planned models, scenario count, trials and the cost cap.

## Writing rules (code, comments, docs, commit messages)

- NO em dashes or en dashes anywhere, in any file, comment, README, YAML or commit message. Use a comma, colon, period, parentheses or a plain hyphen. Check with: `grep -rnP "[\x{2013}\x{2014}]" . --exclude-dir=.git --exclude-dir=node_modules` (must print nothing).
- No AI buzzwords or hype in docs: avoid words like "leverage", "seamless", "robust", "cutting-edge", "game-changer", "delve", "harness the power", "unlock", "empower", "revolutionize". Write like an engineer explaining their own project.
- The README reports only numbers actually measured from real runs in this repo, with the date and exact model ids. Never invent, estimate or round up results. If a number is not measured yet, write "not measured yet".

## Git

- Author every commit as `Farhaan Khan <farhaan.khan2022@vitstudent.ac.in>`. Use `git -c user.name="Farhaan Khan" -c user.email="farhaan.khan2022@vitstudent.ac.in" commit ...` if the local config differs.
- Commit messages are short, plain and natural, like a person wrote them ("Add refund window check and tests"). NO "Co-Authored-By" lines, NO "Generated with" lines, no emoji, no trailers of any kind.
- Small commits per logical step are fine. Never rewrite history that already exists.
- Do NOT push, create a GitHub repo, or add a remote until Farhaan explicitly says so.

## When you finish a milestone

Run the acceptance checks from `PROMPTS.md`, run the dash grep, commit, then stop and give a short summary: what was built, test results, anything skipped or uncertain, and the next milestone.
