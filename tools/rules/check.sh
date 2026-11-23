#!/usr/bin/env bash
# Lists Beppe (formerly Wind Tunnel) rules on the site (Automation REST API) and saves each to fixtures/rules/imported-<uuid>.json (test D).
# Needs FORGE_EMAIL / FORGE_API_TOKEN (source .forge-env). Read-only.
set -euo pipefail
cd "$(dirname "$0")/../.."
SITE=${SITE:-https://one-atlas-fuee.atlassian.net}
CID=$(curl -fsS "$SITE/_edge/tenant_info" | python3 -c 'import sys,json;print(json.load(sys.stdin)["cloudId"])')
API="$SITE/gateway/api/automation/public/jira/$CID/rest/v1"
mkdir -p fixtures/rules
q=""
while :; do
  page=$(curl -fsS -u "$FORGE_EMAIL:$FORGE_API_TOKEN" "$API/rule/summary$q")
  for u in $(echo "$page" | python3 -c 'import sys,json;[print(x["uuid"]) for x in json.load(sys.stdin)["data"] if any(n in (x["name"]+(x.get("description") or "")) for n in ("Wind Tunnel","Beppe"))]'); do
    curl -fsS -u "$FORGE_EMAIL:$FORGE_API_TOKEN" "$API/rule/$u" | python3 -m json.tool > "fixtures/rules/imported-$u.json"
    python3 -c 'import json,sys;r=json.load(open(sys.argv[1]))["rule"];print(sys.argv[2],r["state"],r["name"]);[print("   ",c["component"],c["type"],c["schemaVersion"]) for c in [r["trigger"]]+r["components"]]' "fixtures/rules/imported-$u.json" "$u"
  done
  q=$(echo "$page" | python3 -c 'import sys,json;print(json.load(sys.stdin)["links"]["next"] or "")')
  [ -z "$q" ] && break
done
