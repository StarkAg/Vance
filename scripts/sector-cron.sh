#!/usr/bin/env bash
# Pushes a sector-rotation snapshot to Convex, but ONLY during NSE market hours
# (Mon–Fri, 09:15–15:30 IST) plus one catch-up pull just after close. launchd
# fires this every 15 min; this gate keeps it from hammering the API overnight.
#
# Install (macOS launchd):
#   cp scripts/com.vance.sector.plist ~/Library/LaunchAgents/
#   # edit the plist: set WorkingDirectory + node path to absolute paths
#   launchctl load ~/Library/LaunchAgents/com.vance.sector.plist
#   launchctl start com.vance.sector            # optional: run once now
# Logs -> sector-cron.log in the project root.
set -euo pipefail

cd "$(dirname "$0")/.."

# Current time in IST regardless of machine timezone.
mins=$(TZ="Asia/Kolkata" date +"%H * 60 + %M" | bc)   # minutes since IST midnight
dow=$(TZ="Asia/Kolkata" date +%u)                      # 1=Mon .. 7=Sun

open=555    # 09:15
close=945   # 15:45 (a 15-min grace past 15:30 close for the final pull)

if [ "$dow" -ge 6 ]; then echo "$(date) skip: weekend"; exit 0; fi
if [ "$mins" -lt "$open" ] || [ "$mins" -gt "$close" ]; then
  echo "$(date) skip: outside market hours (IST mins=$mins)"; exit 0
fi

echo "$(date) running sector push…"
node scripts/sector-uptrend.mjs --push
