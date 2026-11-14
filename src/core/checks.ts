/**
 * The result type every verifier step produces, and helpers for building and summarizing them.
 * Browser-safe.
 * @module
 */

/** The sections a verification report is grouped into, in display order. */
export const CHECK_GROUPS = ["Enclave hardware", "Signed answers", "Report file", "On-chain payment"] as const;

/** One of {@link CHECK_GROUPS}. */
export type CheckGroup = (typeof CHECK_GROUPS)[number];

/**
 * One verification result.
 *
 * `ok` is three-valued: `true` passed, `false` failed, `null` could not be checked in this
 * environment (for example NVIDIA's attestation service, which refuses browser requests).
 * A `null` never counts as a pass in the UI, but it doesn't fail the report either.
 */
export interface Check {
  name: string;
  ok: boolean | null;
  /** Why it failed or couldn't run, or a value worth showing (a hash, a status). */
  detail?: string;
  group?: CheckGroup;
}

/** Build a check whose detail is a list of problems: it passes only when the list is empty. */
export function checkFromProblems(name: string, problems: string[], separator = "; "): Check {
  return { name, ok: problems.length === 0, detail: problems.join(separator) || undefined };
}

/** Returns a mapper that files checks under `group`. */
export function inGroup(group: CheckGroup): (check: Check) => Check {
  return (check) => ({ ...check, group });
}

/** True when nothing failed. Checks that couldn't run (`ok: null`) don't fail the report. */
export function allPassed(checks: readonly Check[]): boolean {
  return checks.every((c) => c.ok !== false);
}

/** The message of an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
