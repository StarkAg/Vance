#!/usr/bin/env node
// Sector-rotation "dip in strength" screen, run locally (residential IP gets
// past the bot block that datacenter IPs hit).
//
// Pipeline:
//   1. Pull cap-weighted sector returns over 1W / 1M / 3M (+ 1D for display)
//      from Moneycontrol's undocumented sector API.
//   2. Pull each sector's advance/decline breadth + trend from the page's
//      embedded __NEXT_DATA__.
//   3. ALIGNED uptrend = positive on 3M & 1M & 1W (real medium-term trend that
//      is still rising) — ranked by a blended momentum + breadth score.
//   4. BROAD = breadth > MIN_BREADTH (the move is across many stocks, not 2
//      mega-caps — this is what kills the "cap-weighted illusion").
//   5. Within each broad sector, list LIQUID (mcap >= MIN_MCAP) stocks that are
//      RED today => dips inside a strong, broad uptrend = buy candidates.
//
// Usage:
//   node scripts/sector-uptrend.mjs            # full screen (console)
//   node scripts/sector-uptrend.mjs --json     # machine-readable output
//   node scripts/sector-uptrend.mjs --push      # push snapshot to Convex prod (for the dashboard)
//
// NOTE: uses an undocumented Moneycontrol endpoint that may change/break at any
// time. Personal/educational use. Not affiliated with or endorsed by Moneycontrol.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---- tunables -------------------------------------------------------------
const MIN_BREADTH = 0.30; // 30% net advance/decline => "broad" move
const MIN_MCAP = 500;     // Rs Cr — drop penny/micro noise ("liquid")
const WEIGHTS = { m3: 0.4, m1: 0.35, w1: 0.25, breadth: 3 }; // score blend
// ---------------------------------------------------------------------------

const JSON_OUT = process.argv.includes('--json');
const PUSH = process.argv.includes('--push');
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json,text/html;q=0.9',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.moneycontrol.com/',
};
const API = 'https://api.moneycontrol.com/mcapi/v1/sector/performance';
const PAGE = 'https://www.moneycontrol.com/markets/sector-analysis';

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

async function fail(msg) {
  console.error('✗ ' + msg);
  console.error('  If blocked (403/503), run on a normal home connection — not a VPN/datacenter IP.');
  process.exit(1);
}

// Cap-weighted return per sector for a given duration: { "Banks": 0.59, ... }
async function returns(dur) {
  const res = await fetch(`${API}?dur=${dur}&type=top&section=sector&limit=60`, { headers: HEADERS });
  if (!res.ok) await fail(`HTTP ${res.status} from sector API (dur=${dur})`);
  const j = await res.json();
  if (j.success !== 1 || !Array.isArray(j.data)) await fail(`Unexpected sector API payload: ${JSON.stringify(j).slice(0, 120)}`);
  return Object.fromEntries(j.data.map((r) => [r.sector, r.mcapPerChange]));
}

// Deep-walk __NEXT_DATA__ to find the largest array of objects matching a probe.
function findArray(root, probe) {
  let best = [];
  const seen = new Set();
  (function walk(n) {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      if (n[0] && typeof n[0] === 'object' && probe(n[0]) && n.length > best.length) best = n;
      n.forEach(walk);
    } else Object.values(n).forEach(walk);
  })(root);
  return best;
}

async function nextData(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) await fail(`HTTP ${res.status} from ${url}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) await fail(`No __NEXT_DATA__ at ${url}`);
  return JSON.parse(m[1]);
}

async function breadthAndTrend() {
  const rows = findArray(await nextData(PAGE), (o) => o.sector && 'advance' in o);
  const map = {};
  for (const r of rows) {
    const tot = (r.advance || 0) + (r.decline || 0);
    map[r.sector] = {
      breadth: tot ? (r.advance - r.decline) / tot : 0,
      trend: r.trend || '',
      slug: r.slug,
    };
  }
  return map;
}

async function sectorStocks(slug) {
  const rows = findArray(await nextData(`${PAGE}/${slug}/`), (o) => o.stockName && 'perChange' in o);
  return rows.map((r) => ({
    name: r.stockName,
    scId: r.scId,
    price: num(r.currPrice),
    chg: num(r.perChange),
    mcap: num(r.marketCap),
    trend: r.techTrend || '',
  }));
}

(async () => {
  // 1+2: returns over timeframes + breadth/trend
  const [d1, w1, m1, m3, meta] = await Promise.all([
    returns('1d'), returns('5d'), returns('1m'), returns('3m'), breadthAndTrend(),
  ]);

  // 3: aligned + ranked
  const sectors = [...new Set([...Object.keys(m1), ...Object.keys(m3)])]
    .map((s) => {
      const b = meta[s] || { breadth: 0, trend: '', slug: null };
      return { s, d1: d1[s], w1: w1[s], m1: m1[s], m3: m3[s], ...b };
    })
    .filter((x) => x.m3 > 0 && x.m1 > 0 && x.w1 > 0)
    .map((x) => ({
      ...x,
      score: +(x.m3 * WEIGHTS.m3 + x.m1 * WEIGHTS.m1 + x.w1 * WEIGHTS.w1 + x.breadth * WEIGHTS.breadth).toFixed(2),
    }))
    .sort((a, b) => b.score - a.score);

  // 4: broad only
  const broad = sectors.filter((x) => x.breadth >= MIN_BREADTH);

  // 5: liquid red-today stocks inside each broad sector
  const picks = await Promise.all(
    broad.map(async (sec) => {
      const stocks = (await sectorStocks(sec.slug))
        .filter((st) => st.chg !== null && st.chg < 0 && st.mcap !== null && st.mcap >= MIN_MCAP)
        .sort((a, b) => a.chg - b.chg); // biggest dip first
      return { sector: sec, stocks };
    })
  );

  // IST timestamp (UTC+5:30) for display — Date math is fine here, this is a CLI.
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const fetchedAtIST = ist.toISOString().replace('T', ' ').slice(0, 16) + ' IST';
  const payload = { ranked: sectors, broad, picks, fetchedAtIST };

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (PUSH) {
    const { ConvexHttpClient } = await import('convex/browser');
    const { api } = await import('../convex/_generated/api.js');
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    const env = readFileSync(join(root, '.env.local'), 'utf8');
    const url = env.match(/^VITE_CONVEX_URL=(.+)$/m)?.[1]?.trim();
    if (!url) await fail('VITE_CONVEX_URL not found in .env.local');
    const client = new ConvexHttpClient(url);
    await client.mutation(api.sector.push, { updatedAt: now.getTime(), payload: JSON.stringify(payload) });
    console.log(`✓ pushed snapshot to Convex (${broad.length} broad sectors, ${fetchedAtIST})`);
    return;
  }

  const pctW = (n) => (n == null ? '   n/a' : `${n > 0 ? '+' : ''}${n}%`).padStart(7);
  console.log('\n══ ALIGNED UPTREND SECTORS (3M>0 & 1M>0 & 1W>0), ranked ══\n');
  for (const x of sectors) {
    const tag = x.breadth >= MIN_BREADTH ? '◆ BROAD' : '  narrow';
    console.log(`${x.s.padEnd(22)} 3M${pctW(x.m3)}  1M${pctW(x.m1)}  1W${pctW(x.w1)}  breadth ${(x.breadth * 100).toFixed(0).padStart(4)}%  score ${String(x.score).padStart(6)}  ${tag}  [${x.trend}]`);
  }

  console.log(`\n══ DIP-IN-STRENGTH BUY CANDIDATES ══`);
  console.log(`(broad sectors with breadth ≥ ${(MIN_BREADTH * 100).toFixed(0)}% · stocks red today · mcap ≥ ₹${MIN_MCAP} Cr · biggest dip first)\n`);
  let total = 0;
  for (const { sector, stocks } of picks) {
    console.log(`▼ ${sector.s}  (breadth ${(sector.breadth * 100).toFixed(0)}%, score ${sector.score})`);
    if (!stocks.length) { console.log('    — no liquid red-today names —'); continue; }
    for (const st of stocks) {
      total++;
      console.log(`    ${st.name.padEnd(22)} ${`${st.chg}%`.padStart(7)}   ₹${(st.price ?? '?').toLocaleString('en-IN').padStart(10)}   mcap ₹${st.mcap.toLocaleString('en-IN')} Cr   [${st.trend}]`);
    }
  }
  console.log(`\n${total} buy candidate(s) across ${broad.length} broad sector(s).`);
})();
