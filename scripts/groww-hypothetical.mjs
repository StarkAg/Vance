#!/usr/bin/env node
/**
 * Point-in-time Nifty 50 comparison for a ₹99,994.90 notional investment.
 *
 * Price source: Groww Historical Candle API (NSE closing candles).
 * Corporate-action source: Yahoo Finance's split event feed.  The multiplier
 * changes the number of shares for stock splits and bonus issues; cash
 * dividends are intentionally excluded, so this is a corporate-action-adjusted
 * PRICE return, not a total return.
 *
 * The basket is the Nifty 50 membership on 5 Aug 2024, corroborated by the
 * Taurus MF 8-Aug-2024 Nifty-50 constituent PDF.  That avoids looking ahead
 * with the 2026 membership list.
 */
import { readFileSync } from "node:fs";

const investment = 99_994.90;
const start = "2024-08-05";
const end = "2026-09-22";
const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);

// Nifty 50 constituent symbols as at 5 Aug 2024.
const symbols = [
  "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
  "BAJAJ-AUTO", "BAJAJFINSV", "BAJFINANCE", "BHARTIARTL", "BPCL",
  "BRITANNIA", "CIPLA", "COALINDIA", "DIVISLAB", "DRREDDY", "EICHERMOT",
  "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE", "HEROMOTOCO", "HINDALCO",
  "HINDUNILVR", "ICICIBANK", "INDUSINDBK", "INFY", "ITC", "JSWSTEEL",
  "KOTAKBANK", "LT", "LTIM", "M&M", "MARUTI", "NESTLEIND", "NTPC", "ONGC",
  "POWERGRID", "RELIANCE", "SBILIFE", "SBIN", "SHRIRAMFIN", "SUNPHARMA",
  "TATACONSUM", "TATAMOTORS", "TATASTEEL", "TCS", "TECHM", "TITAN",
  "ULTRACEMCO", "WIPRO",
];

function accessToken() {
  const line = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").find((x) => x.startsWith("GROWW_ACCESS_TOKEN="));
  if (!line) throw new Error("GROWW_ACCESS_TOKEN is not present in .env.local. Run groww-token.mjs first.");
  return line.slice("GROWW_ACCESS_TOKEN=".length).replace(/^['\"]|['\"]$/g, "");
}

const token = accessToken();
const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "X-API-VERSION": "1.0" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function growwClose(exchange, growwSymbol, date) {
  const url = new URL("https://api.groww.in/v1/historical/candles");
  url.search = new URLSearchParams({
    exchange, segment: "CASH", groww_symbol: growwSymbol,
    start_time: `${date} 09:15:00`, end_time: `${date} 15:30:00`, candle_interval: "1day",
  });
  const res = await fetch(url, { headers });
  const data = await res.json().catch(() => null);
  const candle = data?.payload?.candles?.[0];
  if (!res.ok || !candle) throw new Error(`${growwSymbol} ${date}: ${data?.error?.message ?? "no daily candle"}`);
  return Number(candle[4]); // [timestamp, open, high, low, close, volume, oi]
}

async function splitMultiplier(symbol) {
  // Yahoo is only used for split/bonus mechanics, never for stock prices.
  const url = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${symbol}.NS`)}`);
  url.search = new URLSearchParams({ period1: String(Date.parse(`${start}T00:00:00Z`) / 1000), period2: String(Date.parse(`${end}T23:59:59Z`) / 1000), interval: "1d", events: "splits" });
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`split feed for ${symbol}: HTTP ${res.status}`);
  const events = Object.values(data?.chart?.result?.[0]?.events?.splits ?? {});
  return events.reduce((multiple, event) => multiple * (Number(event.numerator) / Number(event.denominator)), 1);
}

async function one(symbol) {
  // NSE changed LTIMindtree's trading symbol from LTIM to LTM on 17 Apr 2026;
  // this is a name/symbol change only, so it carries no share multiplier.
  if (symbol === "LTIM") {
    const [startClose, endClose] = await Promise.all([
      growwClose("NSE", "NSE-LTIM", start),
      growwClose("NSE", "NSE-LTM", end),
    ]);
    const shares = investment / startClose;
    const value = shares * endClose;
    const profit = value - investment;
    const returnPct = profit / investment * 100;
    const cagr = ((value / investment) ** (365 / days) - 1) * 100;
    return { symbol, startClose, endClose, splitFactor: 1, shares, value, profit, returnPct, cagr };
  }

  // Tata Motors was demerged on a 1:1 entitlement in 2025.  A pre-demerger
  // TATAMOTORS share became one TMPV share plus one TMCV share, so closing
  // value is the two Groww closes added together rather than a single ticker.
  if (symbol === "TATAMOTORS") {
    const [startClose, tmpvClose, tmcvClose] = await Promise.all([
      growwClose("NSE", "NSE-TATAMOTORS", start),
      growwClose("NSE", "NSE-TMPV", end),
      growwClose("NSE", "NSE-TMCV", end),
    ]);
    const endClose = tmpvClose + tmcvClose;
    const shares = investment / startClose;
    const value = shares * endClose;
    const profit = value - investment;
    const returnPct = profit / investment * 100;
    const cagr = ((value / investment) ** (365 / days) - 1) * 100;
    return { symbol, startClose, endClose, splitFactor: 1, shares, value, profit, returnPct, cagr, components: { TMPV: tmpvClose, TMCV: tmcvClose } };
  }

  const [startClose, endClose, splitFactor] = await Promise.all([
    growwClose("NSE", `NSE-${symbol}`, start),
    growwClose("NSE", `NSE-${symbol}`, end),
    splitMultiplier(symbol),
  ]);
  const shares = (investment / startClose) * splitFactor;
  const value = shares * endClose;
  const profit = value - investment;
  const returnPct = profit / investment * 100;
  const cagr = ((value / investment) ** (365 / days) - 1) * 100;
  return { symbol, startClose, endClose, splitFactor, shares, value, profit, returnPct, cagr };
}

async function limitedMap(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    const group = await Promise.allSettled(items.slice(i, i + limit).map(fn));
    out.push(...group);
    if (i + limit < items.length) await sleep(1_100); // Groww historical-data quota: keep below 10 req/s.
  }
  return out;
}

const settled = await limitedMap(symbols, 1, one);
const results = settled.map((result, index) => ({ symbol: symbols[index], result }));
const rows = results.filter(({ result }) => result.status === "fulfilled").map(({ result }) => result.value)
  .sort((a, b) => b.returnPct - a.returnPct);
const failures = results.filter(({ result }) => result.status === "rejected")
  .map(({ symbol, result }) => ({ symbol, error: String(result.reason?.message ?? result.reason) }));

const fmt = (n, digits = 2) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
console.log(JSON.stringify({
  metadata: {
    investment, start, end, days, priceBasis: "Groww NSE daily closing price; split/bonus-adjusted shares; dividends excluded",
    successful: rows.length, failed: failures.length,
  },
  rows: rows.map((r, i) => ({ rank: i + 1, ...r })),
  summary: {
    medianReturnPct: rows[Math.floor(rows.length / 2)]?.returnPct,
    averageReturnPct: rows.reduce((sum, r) => sum + r.returnPct, 0) / rows.length,
    top20: rows.slice(0, 20), bottom10: rows.slice(-10),
  },
  failures,
}, null, 2));

console.error(`Completed ${rows.length}/${symbols.length}. Values are ₹; quick sample: ${rows.slice(0, 3).map((r) => `${r.symbol} ₹${fmt(r.value)}`).join(", ")}`);
