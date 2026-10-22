#!/bin/sh
# Push, move the web app deployment to the new version, then check the live API answers JSON (not a Google page).
set -e
cd "$(dirname "$0")"
if [ -n "$CLASP" ]; then :; elif command -v clasp >/dev/null 2>&1; then CLASP=clasp; else CLASP="npx --yes @google/clasp@3.4.1"; fi
export CLASP
DEPLOYMENT=$(cat deployment-id)
sh push.sh
$CLASP update-deployment "$DEPLOYMENT" --description "Saxlan backend"
URL="https://script.google.com/macros/s/$DEPLOYMENT/exec"
out=$(curl -s -L -H 'Content-Type: text/plain;charset=utf-8' --data '{"fn":"rpcPing","args":[]}' "$URL")
case "$out" in
  *'"ok":true'*) echo "live check ok: $URL" ;;
  *'"error":"setup"'*) echo "deployed, but setup() has not been run yet (open the script editor and run setup once)" ;;
  *) if echo "$out" | grep -qi "authoriz\|permission\|ServiceLogin\|accounts.google.com"; then
       echo "deployed, but the owner has not authorized the project yet: run setup() once in the Apps Script editor" >&2
     else
       echo "LIVE CHECK FAILED: $(echo "$out" | head -c 300)" >&2; exit 1
     fi ;;
esac
