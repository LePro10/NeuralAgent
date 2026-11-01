#!/bin/sh
# Monthly: fetch the free DB-IP "IP to Country Lite" table (CC BY 4.0, https://db-ip.com) into the
# relay's data folder and restart the relay so it loads it. Only countries are derived from it;
# the relay stores no IP addresses (docs/notes/insights.md). Run as root on the relay host, e.g.
# from cron: `17 4 3 * * /opt/neuralagent/geoip.sh`.
set -eu
DATA=/var/lib/neuralagent
month=$(date -u +%Y-%m)
url="https://download.db-ip.com/free/dbip-country-lite-$month.csv.gz"
tmp=$(mktemp)
trap 'rm -f "$tmp" "$tmp.csv"' EXIT
curl -fsSL "$url" -o "$tmp"
gunzip -c "$tmp" > "$tmp.csv"
# Sanity check: a real table has hundreds of thousands of rows.
[ "$(wc -l < "$tmp.csv")" -gt 100000 ] || { echo "geoip table looks wrong, keeping the old one"; exit 1; }
if [ -f "$DATA/geoip.csv" ] && cmp -s "$tmp.csv" "$DATA/geoip.csv"; then echo "geoip unchanged"; exit 0; fi
install -o 10001 -g 10001 -m 0644 "$tmp.csv" "$DATA/geoip.csv"
cd /opt/neuralagent && docker compose restart relay >/dev/null
echo "geoip table $month installed"
