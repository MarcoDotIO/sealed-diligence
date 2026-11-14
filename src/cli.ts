#!/usr/bin/env -S npx tsx
/**
 * `sealed-diligence` command-line entry point. Run with no arguments for usage.
 *
 * This path is printed inside every DILIGENCE.md ("Check it: npx tsx src/cli.ts verify …"), so it must
 * not move.
 * @module
 */
import { parseArgs } from "node:util";
import { COMMANDS, type CommandInput, usage } from "./cli/commands.ts";
import { errorMessage } from "./core/checks.ts";

async function main(argv: string[]): Promise<void> {
  const [name, ...rest] = argv;
  const command = COMMANDS.find((c) => c.name === name);
  if (!command) {
    console.log(usage());
    process.exitCode = name ? 1 : 0;
    return;
  }
  const { positionals, values } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: Object.fromEntries(Object.entries(command.options).map(([option, type]) => [option, { type }])),
  });
  if (positionals.length < command.required) throw new Error(`usage: sealed-diligence ${command.name} ${command.synopsis}`);
  await command.run({ positionals, options: values } as CommandInput);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`error: ${errorMessage(error)}`);
  process.exitCode = 1;
});
