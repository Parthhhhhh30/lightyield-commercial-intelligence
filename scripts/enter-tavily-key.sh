#!/usr/bin/env bash
# Private entry of the Tavily search key into the git-ignored .dev.vars (mode 600). The key is read from the terminal with echo off; it is never printed,
# never passed on a command line, never logged. Run it yourself in Terminal. It only edits the TAVILY_API_KEY line; other lines are preserved.
set -euo pipefail
cd "$(dirname "$0")/.."; F=${LY_DEVVARS:-.dev.vars}
git check-ignore -q "$F" || { echo "REFUSING: $F is not git-ignored"; exit 1; }
git ls-files --error-unmatch "$F" >/dev/null 2>&1 && { echo "REFUSING: $F is tracked by git"; exit 1; } || true
[ "${LY_PROMPT_FROM_STDIN:-}" = 1 ] && exec 3<&0 || { ( : </dev/tty ) 2>/dev/null && exec 3</dev/tty || { echo "REFUSING: needs a real terminal (Terminal/iTerm)."; exit 1; }; }
printf '\n>>> Paste your Tavily API key (starts with tvly-; input hidden): ' >&2
IFS= read -u 3 -rs KEY || { echo; echo "no input"; exit 1; }; echo >&2
KEY=${KEY//$'\r'/}; KEY="${KEY#"${KEY%%[![:space:]]*}"}"; KEY="${KEY%"${KEY##*[![:space:]]}"}"
[[ "$KEY" =~ ^tvly-[A-Za-z0-9_-]{16,}$ ]] || { echo "That does not look like a Tavily key (expected tvly-...). Nothing was written."; exit 1; }
umask 077; TMP=$(mktemp "${F}.XXXXXX"); trap 'rm -f "$TMP"' EXIT
[ -f "$F" ] && grep -v '^TAVILY_API_KEY=' "$F" > "$TMP" || true
printf 'TAVILY_API_KEY=%s\n' "$KEY" >> "$TMP"; chmod 600 "$TMP"; mv "$TMP" "$F"; trap - EXIT
[ "$(stat -f '%Lp' "$F" 2>/dev/null || stat -c '%a' "$F")" = 600 ] || { echo "WARNING: could not confirm mode 600 on $F"; exit 1; }
echo "Tavily key stored in $F (mode 600). Value not shown."
