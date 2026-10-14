# Decisions

- Stack: TypeScript on Node 22 with the Vercel AI SDK, zod, yaml and vitest, run with tsx. Reasons in [SRS section 12](../SRS.md#12-stack-and-justification).
- Pinned (2026-10-14): ai 7.0.140, @ai-sdk/openai 4.0.93, @ai-sdk/anthropic 4.0.79, @ai-sdk/groq 4.0.60, zod 4.6.7, yaml 2.9.1, typescript 7.0.2, tsx 4.23.15, vitest 5.0.4, @types/node 22.20.5.
- ai 7 has `wrapLanguageModel` with v4 middleware (`wrapGenerate`) and `MockLanguageModelV4` in `ai/test`, which is all the cassette layer and the tests need.
- The agent loop calls `generateText` once per step (`stopWhen: stepCountIs(1)`) instead of letting the SDK loop, so the harness owns step numbering, the step limit and the cost check before every call.
- Tools are given to the SDK as plain JSON schema without SDK side validation; the toolbox parses arguments with zod itself, so bad arguments come back to the model as an `INVALID_ARGS` error result and land in the tool log.
