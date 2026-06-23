"use node";

import { action } from "./_generated/server";
import { api } from "./_generated/api";

// Server-side sector-rotation scan — a port of scripts/sector-uptrend.mjs.
// (The script's "datacenter IPs are bot-blocked" warning turned out to be stale;
// Convex reaches Moneycontrol fine, so the scan can run on demand from the app.)
// Pulls cap-weighted sector returns (1d/5d/1m/3m) + advance/decline breadth, finds
// aligned uptrend sectors, and lists liquid red-today "dip in strength" names.

const MIN_BREADTH = 0.3;
const MIN_MCAP = 500; // ₹ Cr
const WEIGHTS = { m3: 0.4, m1: 0.35, w1: 0.25, breadth: 3 };

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json,text/html;q=0.9",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.moneycontrol.com/",
};
const API = "https://api.moneycontrol.com/mcapi/v1/sector/performance";
const PAGE = "https://www.moneycontrol.com/markets/sector-analysis";

const num = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Deep-walk a __NEXT_DATA__ tree for the largest array of objects matching a probe.
function findArray(root: unknown, probe: (o: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  let best: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  (function walk(n: unknown) {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      const first = n[0] as Record<string, unknown> | undefined;
      if (first && typeof first === "object" && probe(first) && n.length > best.length) best = n as Record<string, unknown>[];
      n.forEach(walk);
    } else {
      Object.values(n as Record<string, unknown>).forEach(walk);
    }
  })(root);
  return best;
}

async function returns(dur: string): Promise<Record<string, number>> {
  const res = await fetch(`${API}?dur=${dur}&type=top&section=sector&limit=60`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Moneycontrol sector API HTTP ${res.status} (dur=${dur}) — blocked or changed.`);
  const j = (await res.json()) as { success?: number; data?: Array<{ sector: string; mcapPerChange: number }> };
  if (j.success !== 1 || !Array.isArray(j.data)) throw new Error(`Unexpected sector API payload (dur=${dur}).`);
  return Object.fromEntries(j.data.map((r) => [r.sector, r.mcapPerChange]));
}

async function nextData(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`No __NEXT_DATA__ at ${url}`);
  return JSON.parse(m[1]);
}

type Meta = { breadth: number; trend: string; slug: string | null };

async function breadthAndTrend(): Promise<Record<string, Meta>> {
  const rows = findArray(await nextData(PAGE), (o) => "sector" in o && "advance" in o);
  const map: Record<string, Meta> = {};
  for (const r of rows) {
    const advance = Number(r.advance ?? 0);
    const decline = Number(r.decline ?? 0);
    const tot = advance + decline;
    map[String(r.sector)] = {
      breadth: tot ? (advance - decline) / tot : 0,
      trend: String(r.trend ?? ""),
      slug: r.slug ? String(r.slug) : null,
    };
  }
  return map;
}

async function sectorStocks(slug: string) {
  const rows = findArray(await nextData(`${PAGE}/${slug}/`), (o) => "stockName" in o && "perChange" in o);
  return rows.map((r) => ({
    name: String(r.stockName ?? ""),
    scId: String(r.scId ?? ""),
    price: num(r.currPrice),
    chg: num(r.perChange),
    mcap: num(r.marketCap),
    trend: String(r.techTrend ?? ""),
  }));
}

async function scan() {
  const [d1, w1, m1, m3, meta] = await Promise.all([
    returns("1d"), returns("5d"), returns("1m"), returns("3m"), breadthAndTrend(),
  ]);

  const sectors = [...new Set([...Object.keys(m1), ...Object.keys(m3)])]
    .map((s) => {
      const b = meta[s] || { breadth: 0, trend: "", slug: null };
      return { s, d1: d1[s] ?? null, w1: w1[s] ?? null, m1: m1[s] ?? null, m3: m3[s] ?? null, ...b };
    })
    .filter((x) => (x.m3 ?? 0) > 0 && (x.m1 ?? 0) > 0 && (x.w1 ?? 0) > 0)
    .map((x) => ({
      ...x,
      score: +((x.m3! * WEIGHTS.m3) + (x.m1! * WEIGHTS.m1) + (x.w1! * WEIGHTS.w1) + (x.breadth * WEIGHTS.breadth)).toFixed(2),
    }))
    .sort((a, b) => b.score - a.score);

  const broad = sectors.filter((x) => x.breadth >= MIN_BREADTH);

  const picks = await Promise.all(
    broad.map(async (sec) => {
      const stocks = sec.slug
        ? (await sectorStocks(sec.slug))
            .filter((st) => st.chg !== null && st.chg < 0 && st.mcap !== null && st.mcap >= MIN_MCAP)
            .sort((a, b) => (a.chg ?? 0) - (b.chg ?? 0))
        : [];
      return { sector: sec, stocks };
    }),
  );

  const now = Date.now();
  const fetchedAtIST = new Date(now + 5.5 * 3600_000).toISOString().replace("T", " ").slice(0, 16) + " IST";
  return { payload: { ranked: sectors, broad, picks, fetchedAtIST }, updatedAt: now, broadCount: broad.length, fetchedAtIST };
}

// Run the scan and store it as the live sector snapshot.
export const runSectorScan = action({
  args: {},
  handler: async (ctx): Promise<{ broad: number; sectors: number; fetchedAtIST: string }> => {
    const { payload, updatedAt, broadCount, fetchedAtIST } = await scan();
    await ctx.runMutation(api.sector.push, { updatedAt, payload: JSON.stringify(payload) });
    return { broad: broadCount, sectors: payload.ranked.length, fetchedAtIST };
  },
});

// The button flow: scan fresh sector data, then generate today's option ideas off it.
export const scanAndGenerate = action({
  args: {},
  handler: async (ctx): Promise<{ broad: number; generated: number; skipped?: string }> => {
    const { payload, updatedAt, broadCount } = await scan();
    await ctx.runMutation(api.sector.push, { updatedAt, payload: JSON.stringify(payload) });
    const ideas = await ctx.runAction(api.agent.generateIdeas, {});
    return { broad: broadCount, ...ideas };
  },
});
