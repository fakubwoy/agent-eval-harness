# agent-eval-harness

A small harness that tests a tool-calling customer support agent against a fake e-commerce backend (orders, refunds, address changes, order status) and compares models on task success, correct tool use, policy adherence, human handoff, turns, latency, tokens and cost.

The scenarios include the cases that break support agents in practice: ambiguous or incomplete requests, refunds outside the 30 day window, prompt injection inside a customer message, tool errors and timeouts, multi-turn clarification and escalation to a human. The backend is in-memory and seeded, and model calls are recorded to cassettes, so results are reproducible and CI runs without API keys.

## Status

In progress. The spec is in [SRS.md](SRS.md). There are no results yet; this section will hold a table of measured numbers once the first real comparison run is done.

## Run it (once built)

```bash
npm ci
npm test                                                     # no keys needed
npx tsx src/cli.ts run --models openai:gpt-4.1-mini,anthropic:claude-haiku-4-5,groq:llama-3.3-70b-versatile --mode replay
npx tsx src/cli.ts report --in results/<run_id>
```

Live runs need keys in `.env` (see `.env.example`) and stop when `MAX_RUN_COST_USD` is reached.
