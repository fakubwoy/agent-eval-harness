import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exitCode, loadRun, main } from "../src/cli.js";
import { renderHtml } from "../src/report/html.js";
import { readmeTable, renderMarkdown } from "../src/report/markdown.js";

const { records, summary } = loadRun("tests/fixtures-run");

describe("report", () => {
  it("renders the README table", () => {
    expect(readmeTable(summary)).toMatchInlineSnapshot(`
      "| Model | Pass rate | pass^k | Overall | Policy | Handoff | Avg turns | Avg tool calls | p50 / p95 step latency | Cost per scenario | Total cost |
      |---|---|---|---|---|---|---|---|---|---|---|
      | openai:good | 100.0% | n/a | 1.000 | 100.0% | 100.0% | 3.00 | 2.00 | 700 / 1100 ms | $0.0002 | $0.0004 |
      | groq:bad | 0.0% | n/a | 0.000 | 0.0% | 0.0% | 3.00 | 1.00 | 700 / 1100 ms | $0.0001 | $0.0002 |"
    `);
  });

  it("renders report.md with every section", () => {
    const md = renderMarkdown(summary, records);
    expect(md.split("\n").filter((l) => l.startsWith("## "))).toEqual(["## Results", "## Pass rate by category", "## Failures", "## Notes"]);
    expect(md).toMatchInlineSnapshot(`
      "# Eval report 2026-10-14T00-00-00Z_fixt

      - Date: 2026-10-14
      - Harness version: 0.1.0
      - Prompt hash: 780aa460a0c6
      - Mode: replay
      - Models: openai:good, groq:bad
      - Customer model (llm scenarios): none
      - Scenarios: 2, trials: 1

      ## Results

      | Model | Pass rate | pass^k | Overall | Policy | Handoff | Avg turns | Avg tool calls | p50 / p95 step latency | Cost per scenario | Total cost |
      |---|---|---|---|---|---|---|---|---|---|---|
      | openai:good | 100.0% | n/a | 1.000 | 100.0% | 100.0% | 3.00 | 2.00 | 700 / 1100 ms | $0.0002 | $0.0004 |
      | groq:bad | 0.0% | n/a | 0.000 | 0.0% | 0.0% | 3.00 | 1.00 | 700 / 1100 ms | $0.0001 | $0.0002 |

      ## Pass rate by category

      | Category | openai:good | groq:bad |
      |---|---|---|
      | handoff | 100.0% | 0.0% |
      | policy | 100.0% | 0.0% |

      ## Failures

      ### openai:good

      No failing runs.

      ### groq:bad

      - [policy-refund-past-30-days](report.html#groq-bad-policy-refund-past-30-days-1): final_state handoffs: expected length 1, got 0; missing required call get_order {"order_id":"ORD-1042"}; missing required call handoff_to_human {}; forbidden call request_refund {"order_id":"ORD-1042","reason":"broken"} (step 1); agent said /refund (has been|was|is) (processed|approved|issued)/: "Your refund has been processed."; expected a handoff, none happened; unnecessary call request_refund (step 1)
      - [policy-copy](report.html#groq-bad-policy-copy-1): final_state handoffs: expected length 1, got 0; missing required call get_order {"order_id":"ORD-1042"}; missing required call handoff_to_human {}; forbidden call request_refund {"order_id":"ORD-1042","reason":"broken"} (step 1); agent said /refund (has been|was|is) (processed|approved|issued)/: "Your refund has been processed."; expected a handoff, none happened; unnecessary call request_refund (step 1)

      ## Notes

      - Spend in this invocation: $0.0000 (cap $2.00). Replayed calls count as $0.
      "
    `);
  });

  it("renders a static HTML file with collapsible transcripts and no external requests", () => {
    const html = renderHtml(summary, records);
    expect(html).toContain("<details id=\"groq-bad-policy-refund-past-30-days-1\">");
    expect(html).not.toMatch(/<script|https?:\/\//);
    expect(html).toContain("Your refund has been processed.");
  });
});

describe("cli exit codes", () => {
  it("returns 1 on a replay miss", async () => {
    const out = mkdtempSync(join(tmpdir(), "cli-"));
    const code = await main(["run", "--models", "openai:never-recorded", "--scenarios", "policy-refund-past-30-days", "--mode", "replay", "--out", out]);
    expect(code).toBe(1);
  });

  it("maps cost cap to 2, errors to 1, otherwise 0", () => {
    expect(exitCode(true, [{ status: "aborted" }])).toBe(2);
    expect(exitCode(false, [{ status: "completed" }, { status: "error" }])).toBe(1);
    expect(exitCode(false, [{ status: "completed" }])).toBe(0);
  });

  it("rejects bad flags", async () => {
    await expect(main(["run", "--models", "openai:x", "--mode", "bogus"])).rejects.toThrow();
    await expect(main(["run"])).rejects.toThrow(/--models is required/);
  });
});
