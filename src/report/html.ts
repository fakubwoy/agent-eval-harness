import type { Summary } from "../scoring/aggregate.js";
import type { RunRecord } from "../scoring/result-schema.js";
import { anchor, categoryRows, failingRuns, headerLines, RESULT_HEADERS, resultRows } from "./markdown.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u2013\u2014]/g, (c) => `&#${c.charCodeAt(0)};`);
const table = (headers: string[], rows: string[][]) =>
  `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;

const CSS = `
:root { color-scheme: light dark; --bg: #fff; --fg: #1d1d1f; --muted: #6e6e73; --line: #d2d2d7; --pass: #1a7f37; --fail: #c62828; --code: #f5f5f7; }
@media (prefers-color-scheme: dark) { :root { --bg: #161618; --fg: #f2f2f2; --muted: #a1a1a6; --line: #3a3a3c; --pass: #4ac26b; --fail: #ff6b6b; --code: #222225; } }
body { background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
h1, h2, h3 { line-height: 1.2; } .muted { color: var(--muted); }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; margin: 8px 0 24px; font-variant-numeric: tabular-nums; }
th, td { border-bottom: 1px solid var(--line); padding: 6px 10px; text-align: left; white-space: nowrap; }
details { border: 1px solid var(--line); border-radius: 6px; margin: 6px 0; padding: 6px 10px; }
summary { cursor: pointer; } .pass { color: var(--pass); } .fail { color: var(--fail); }
.msg { margin: 6px 0; padding: 6px 8px; border-radius: 4px; background: var(--code); white-space: pre-wrap; overflow-wrap: anywhere; }
.role { font-weight: 600; margin-right: 6px; }
`;

function transcript(r: RunRecord): string {
  const lines = r.transcript.map((t) => {
    const label = t.role === "tool" ? `tool ${t.tool_name} ${JSON.stringify(t.args)}` : t.role;
    return `<div class="msg"><span class="role">${esc(label)}</span>${esc(t.content)}</div>`;
  });
  const status = r.scores.pass ? `<span class="pass">pass</span>` : `<span class="fail">fail</span>`;
  const failures = r.failures.length ? `<ul>${r.failures.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : "";
  return `<details id="${anchor(r)}"><summary>${status} ${esc(r.scenario_id)} <span class="muted">(${esc(r.category)}, trial ${r.trial}, overall ${r.scores.overall.toFixed(3)}, ended by ${r.ended_by})</span></summary>${failures}${lines.join("")}</details>`;
}

export function renderHtml(s: Summary, records: RunRecord[]): string {
  const parts = [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Eval report ${esc(s.run_id)}</title><style>${CSS}</style></head><body>`,
    `<h1>Eval report ${esc(s.run_id)}</h1><ul class="muted">${headerLines(s).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`,
    `<h2>Results</h2><div class="scroll">${table(RESULT_HEADERS, resultRows(s))}</div>`,
    `<h2>Pass rate by category</h2><div class="scroll">${table(["Category", ...s.models.map((m) => m.model)], categoryRows(s))}</div>`,
    `<h2>Failures</h2>`,
  ];
  for (const m of s.models) {
    const failed = failingRuns(records, m.model);
    parts.push(`<h3>${esc(m.model)}</h3>`, failed.length ? `<ul>${failed.map((r) => `<li><a href="#${anchor(r)}">${esc(r.scenario_id)}</a>: ${esc(r.failures.filter((f) => !f.startsWith("note:")).join("; "))}</li>`).join("")}</ul>` : "<p>No failing runs.</p>");
  }
  parts.push(`<h2>Notes</h2><ul>${[...s.notes, `Spend in this invocation: $${s.cost.spent_usd.toFixed(4)} (cap $${s.cost.cap_usd.toFixed(2)}). Replayed calls count as $0.`].map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);
  parts.push(`<h2>Transcripts</h2>`);
  for (const m of s.models) parts.push(`<h3>${esc(m.model)}</h3>`, ...records.filter((r) => r.model === m.model).map(transcript));
  parts.push("</body></html>");
  return parts.join("\n");
}
