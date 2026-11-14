#!/bin/sh
# Create the Ledgerline demo repo as a git repository with one commit.
# Author, dates and contents are fixed, so the commit is always the same
# (c.f. the commit in examples/ledgerline/README.md) and the sealed sample in
# docs/examples/ledgerline/ passes the closing audit against it.
set -e
DEST="${1:-/tmp/ledgerline}"
HERE="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$DEST" && mkdir -p "$DEST"
cp -R "$HERE/repo/." "$DEST/"
cd "$DEST"
git init -q -b main
git add -A
GIT_AUTHOR_NAME="Ledgerline" GIT_AUTHOR_EMAIL="eng@ledgerline.example" GIT_AUTHOR_DATE="2026-03-02T09:00:00Z" \
GIT_COMMITTER_NAME="Ledgerline" GIT_COMMITTER_EMAIL="eng@ledgerline.example" GIT_COMMITTER_DATE="2026-03-02T09:00:00Z" \
  git -c commit.gpgsign=false commit -qm "Ledgerline 2.3.1"
git rev-parse HEAD
