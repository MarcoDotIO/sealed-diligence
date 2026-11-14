// Read a repository at an exact commit (never the working tree), so the review is tied to that commit.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const git = (repo: string, args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });

export const MAX_FILE_BYTES = 48 * 1024;

const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|rs|py|go|sol|move|cairo|swift|kt|java|c|h|cc|cpp|hpp|rb|php|cs|scala|sh|toml|ya?ml|json|sql|vue|svelte|tf|nix|env|cfg|ini|conf)$/i;
const SKIP =
  /(^|\/)(node_modules|dist|build|out|target|vendor|\.git|\.next|coverage|__pycache__)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|uv\.lock)$|\.min\.(js|css)$/;

export interface RepoFile {
  path: string;
  content: string;
  sha256: string;
  bytes: number;
  truncated: boolean;
}

export function resolveCommit(repo: string, ref = "HEAD"): string {
  return git(repo, ["rev-parse", `${ref}^{commit}`]).toString().trim();
}

export function trackedFiles(repo: string, commit: string): string[] {
  return git(repo, ["ls-tree", "-r", "--name-only", commit]).toString().split("\n").filter(Boolean);
}

export function isReviewable(path: string): boolean {
  return CODE_EXT.test(path) && !SKIP.test(path);
}

export function readAt(repo: string, commit: string, path: string): RepoFile | null {
  const raw = git(repo, ["show", `${commit}:${path}`]);
  if (raw.includes(0)) return null; // binary
  const full = raw.toString("utf8");
  const truncated = raw.length > MAX_FILE_BYTES;
  return {
    path,
    content: truncated ? raw.subarray(0, MAX_FILE_BYTES).toString("utf8") : full,
    sha256: createHash("sha256").update(raw).digest("hex"),
    bytes: raw.length,
    truncated,
  };
}

export function findReadme(paths: string[]): string | undefined {
  return paths.find((p) => /^readme(\.md|\.markdown|\.txt)?$/i.test(p));
}
