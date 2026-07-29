#!/bin/bash
# Post to the pr-sidebar broker. Reads JSON body from stdin.
# Usage: post-to-broker.sh --kind summary|findings --pr-url <url>

BROKER="http://127.0.0.1:47821"

KIND=""
PR_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --kind) KIND="$2"; shift 2 ;;
    --pr-url) PR_URL="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 --kind summary|findings --pr-url <url>"
      echo "Reads JSON body from stdin."
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$KIND" || -z "$PR_URL" ]]; then
  echo "Missing --kind or --pr-url" >&2
  exit 1
fi

if [[ "$KIND" != "summary" && "$KIND" != "findings" ]]; then
  echo "--kind must be 'summary' or 'findings'" >&2
  exit 1
fi

ENCODED=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PR_URL")

if curl -sS -f -X POST \
    -H "Content-Type: application/json" \
    "$BROKER/pr/$ENCODED/$KIND" \
    --data @- ; then
  exit 0
else
  echo "" >&2
  echo "pr-sidebar broker not reachable at $BROKER — continuing without it." >&2
  exit 0
fi
