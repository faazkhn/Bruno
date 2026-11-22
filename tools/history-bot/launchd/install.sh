#!/bin/sh
# Bundle the bot into one file outside ~/Documents (launchd processes can't read it without a privacy grant),
# copy .env + data, and load a launchd agent that ticks every 15 min.
set -e
cd "$(dirname "$0")/.."
DEST="$HOME/Library/Application Support/windtunnel-history-bot"
mkdir -p "$DEST/data"
npx esbuild src/bot.ts --bundle --platform=node --format=esm --outfile="$DEST/bot.mjs" --log-level=warning
cp .env "$DEST/.env" && chmod 600 "$DEST/.env"
for f in site.json state.json ground-truth.jsonl; do [ -f "$DEST/data/$f" ] || { [ -f "data/$f" ] && cp "data/$f" "$DEST/data/$f"; } || true; done
PLIST="$HOME/Library/LaunchAgents/com.windtunnel.history-bot.plist"
sed "s#__DEST__#$DEST#g; s#__NODE__#$(command -v node)#g" launchd/com.windtunnel.history-bot.plist > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "installed: $DEST (log: $DEST/data/bot.log)"
