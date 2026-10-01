#!/usr/bin/env bash
# Stop hook: remind (never block) when code under apps/ or packages/ changed but nothing under docs/ did.
# Mirrors the `pnpm docs:check` CI rule (plan §20.4).

cat >/dev/null 2>&1 || true   # drain the hook payload on stdin
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

changes="$(git status --porcelain 2>/dev/null)"
[ -z "$changes" ] && exit 0

paths="$(printf '%s\n' "$changes" | sed -E 's/^.{3}//; s/.* -> //; s/^"//; s/"$//')"
code_changed="$(printf '%s\n' "$paths" | grep -E '^(apps|packages)/' | grep -vE '(^|/)(node_modules|\.next|dist|\.turbo)/|\.tsbuildinfo$' | head -n 5)"
docs_changed="$(printf '%s\n' "$paths" | grep -E '^docs/' | head -n 1)"

if [ -n "$code_changed" ] && [ -z "$docs_changed" ]; then
  files="$(printf '%s\n' "$code_changed" | tr '\n' ' ')"
  msg="Docs reminder: code changed under apps/ or packages/ (${files% }) but nothing under docs/. Run the doc-keeper skill or docs-writer agent: update mapped pages, add an ADR for trade-offs, update docs/(project)/changelog.mdx, then run 'pnpm docs:check'."
  # systemMessage is shown to the user; exit 0 so the stop is never blocked.
  if command -v jq >/dev/null 2>&1; then
    jq -cn --arg m "$msg" '{systemMessage: $m}'
  else
    MSG="$msg" node -e 'process.stdout.write(JSON.stringify({systemMessage: process.env.MSG}))'
  fi
fi
exit 0
