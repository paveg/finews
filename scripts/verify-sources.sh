#!/usr/bin/env bash
set -u
URLS=(
  "https://www.federalreserve.gov/feeds/press_all.xml"
  "https://www.boj.or.jp/rss/whatsnew.xml"
  "https://xtech.nikkei.com/rss/index.rdf"
  "https://www.reuters.com/technology/feed/"
  "https://www.reuters.com/markets/feed/"
  "https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5ESOX"
  "https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5EVIX"
  "https://feeds.bbci.co.uk/news/business/rss.xml"
)
for u in "${URLS[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -A "finews/0.0.1" -m 10 "$u")
  printf "%-3s  %s\n" "$code" "$u"
done
