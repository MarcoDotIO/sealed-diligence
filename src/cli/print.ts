/**
 * Prints a verification report to the terminal and sets the exit code.
 * @module
 */
import { allPassed, type Check } from "../core/checks.ts";

const MARK = { pass: "✓", fail: "✗", skipped: "–" } as const;

function mark(check: Check): string {
  if (check.ok === null) return MARK.skipped;
  return check.ok ? MARK.pass : MARK.fail;
}

/** Print checks under their group headings, then the verdict; exit code 1 when anything failed. */
export function printChecks(checks: readonly Check[]): void {
  let group: string | undefined;
  for (const check of checks) {
    if (check.group && check.group !== group) {
      group = check.group;
      console.log(`\n${group}`);
    }
    const detail = check.ok !== true && check.detail ? `\n      ${check.detail}` : "";
    console.log(`  ${mark(check)} ${check.name}${detail}`);
  }
  const passed = allPassed(checks);
  console.log(passed ? "\nVERIFIED" : "\nNOT VERIFIED");
  process.exitCode = passed ? 0 : 1;
}
