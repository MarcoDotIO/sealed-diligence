/**
 * Reads a repository at one exact commit, never the working tree, so a review is tied to that commit.
 * Node only (shells out to `git`).
 * @module
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/** Files larger than this are reviewed in part and marked truncated. */
export const MAX_FILE_BYTES = 48 * 1024;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const NUL_BYTE = 0;

/** Source and config files worth a reviewer's time. Docs are covered by the README check. */
const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|rs|py|go|sol|move|cairo|swift|kt|java|c|h|cc|cpp|hpp|rb|php|cs|scala|sh|toml|ya?ml|json|sql|vue|svelte|tf|nix|env|cfg|ini|conf)$/i;
/** Vendored code, build output and lockfiles. */
const SKIP =
  /(^|\/)(node_modules|dist|build|out|target|vendor|\.git|\.next|coverage|__pycache__)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|uv\.lock)$|\.min\.(js|css)$/;
const README = /^readme(\.md|\.markdown|\.txt)?$/i;

/** One file as it is at the commit. */
export interface RepoFile {
  path: string;
  /** UTF-8 text, cut at {@link MAX_FILE_BYTES} when `truncated`. */
  content: string;
  /** SHA-256 of the full file. */
  sha256: string;
  bytes: number;
  truncated: boolean;
}

/** Whether a path is source or config the review should cover. */
export function isReviewable(path: string): boolean {
  return CODE_EXT.test(path) && !SKIP.test(path);
}

/** A repository frozen at one commit (Repository pattern over `git ls-tree` and `git show`). */
export class GitSnapshot {
  private trackedPaths?: string[];

  private constructor(
    private readonly repo: string,
    /** The full commit hash. */
    readonly commit: string,
  ) {}

  /** Resolve `ref` (a branch, tag or hash) in `repo` to a commit. */
  static at(repo: string, ref = "HEAD"): GitSnapshot {
    return new GitSnapshot(
      repo,
      git(repo, ["rev-parse", `${ref}^{commit}`])
        .toString()
        .trim(),
    );
  }

  /** Every tracked path at the commit. */
  paths(): string[] {
    this.trackedPaths ??= git(this.repo, ["ls-tree", "-r", "--name-only", this.commit]).toString().split("\n").filter(Boolean);
    return this.trackedPaths;
  }

  /** The reviewable files, in path order, at most `limit` of them; binaries are skipped. */
  reviewableFiles(limit: number): RepoFile[] {
    return this.paths()
      .filter(isReviewable)
      .slice(0, limit)
      .map((path) => this.read(path))
      .filter((file): file is RepoFile => file !== null);
  }

  /** The top-level README, if there is one. */
  readme(): RepoFile | null {
    const path = this.paths().find((p) => README.test(p));
    return path ? this.read(path) : null;
  }

  /** Read one file; `null` for binary files. */
  read(path: string): RepoFile | null {
    const raw = git(this.repo, ["show", `${this.commit}:${path}`]);
    if (raw.includes(NUL_BYTE)) return null;
    const truncated = raw.length > MAX_FILE_BYTES;
    return {
      path,
      content: (truncated ? raw.subarray(0, MAX_FILE_BYTES) : raw).toString("utf8"),
      sha256: createHash("sha256").update(raw).digest("hex"),
      bytes: raw.length,
      truncated,
    };
  }
}

function git(repo: string, args: string[]): Buffer {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "buffer", maxBuffer: MAX_GIT_OUTPUT_BYTES });
}
