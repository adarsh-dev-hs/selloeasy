#!/usr/bin/env bash
# PostToolUse hook (Edit|Write|MultiEdit): format the edited file with prettier.
# Receives the hook payload as JSON on stdin ({ "tool_input": { "file_path": "..." }, ... }).
# Never fails the hook — formatting is best-effort.

input="$(cat)"
if command -v jq >/dev/null 2>&1; then
  file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)"
else
  file="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{}})' 2>/dev/null)"
fi

[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.md|*.mdx|*.css) ;;
  *) exit 0 ;;
esac

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" 2>/dev/null || exit 0
# --ignore-unknown + .prettierignore keep generated files (drizzle/, .next/, dataset data) untouched.
npx --no-install prettier --write --ignore-unknown --log-level warn "$file" >/dev/null 2>&1 || true
exit 0
