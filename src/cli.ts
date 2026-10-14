import { parseArgs } from "node:util";

export const USAGE = `Usage: npx tsx src/cli.ts <command> [flags]

Commands:
  run        Run scenarios x models x trials and score them
               --models a,b,c          provider:model list (required)
               --scenarios <sel>       glob, id or category:x (default all)
               --trials N              (default 1)
               --mode live|record|replay|auto   (default replay)
               --user-model provider:model      model playing the customer in llm scenarios
               --concurrency N         (default 4)
               --max-cost USD          (default env MAX_RUN_COST_USD or 2.00)
               --out dir               (default results/<run_id>)
  report     Write report.md and report.html for a results directory
               --in results/<run_id>
               --readme                print only the Markdown results table
  validate   Check every scenario against the schema and the backend
               --scenarios <sel>
  list       List scenarios with id, category and user mode
`;

export async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: { help: { type: "boolean", short: "h" } },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    return 0;
  }
  console.error(`${command}: not implemented`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
