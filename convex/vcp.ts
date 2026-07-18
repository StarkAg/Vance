import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";

// VCP (Volatility Contraction Pattern) scanner — Mark Minervini style. Pulls a
// year of daily OHLCV from Yahoo (same free source as convex/quotes.ts; Groww's
// API has no historical-candle endpoint) for a sector universe and classifies
// each name's stage in a VCP base.
//
// Detection algorithm adapted from pkjmesra/PKScreener's validateVCP:
//   - local-extrema peaks/troughs (order=3)
//   - strictly HIGHER LOWS across the base (the defining VCP trait)
//   - progressive tightening of each pullback leg
//   - proximity to the 52-week high + stage-2 trend template
// Ported to TS with proportional (not absolute) min-tightening so already-tight
// bases aren't over-rejected, plus a "mid" stage (2 legs formed, 3rd not yet).
// Ref: https://github.com/pkjmesra/PKScreener

type EnergyName = readonly [symbol: string, name: string];

// NSE energy + power/renewables universe (Yahoo symbols).
const ENERGY: EnergyName[] = [
  ["RELIANCE.NS", "Reliance Industries"], ["ONGC.NS", "ONGC"], ["NTPC.NS", "NTPC"],
  ["POWERGRID.NS", "Power Grid"], ["COALINDIA.NS", "Coal India"], ["BPCL.NS", "BPCL"],
  ["IOC.NS", "Indian Oil"], ["GAIL.NS", "GAIL"], ["TATAPOWER.NS", "Tata Power"],
  ["ADANIGREEN.NS", "Adani Green"], ["ADANIENSOL.NS", "Adani Energy Solutions"],
  ["ADANIPOWER.NS", "Adani Power"], ["TORNTPOWER.NS", "Torrent Power"], ["JSWENERGY.NS", "JSW Energy"],
  ["NHPC.NS", "NHPC"], ["OIL.NS", "Oil India"], ["PETRONET.NS", "Petronet LNG"],
  ["IGL.NS", "Indraprastha Gas"], ["GUJGASLTD.NS", "Gujarat Gas"], ["SJVN.NS", "SJVN"],
  ["SUZLON.NS", "Suzlon Energy"], ["INOXWIND.NS", "Inox Wind"], ["WEBELSOLAR.NS", "Websol Energy"],
  ["HINDPETRO.NS", "HPCL"], ["CASTROLIND.NS", "Castrol India"], ["RPOWER.NS", "Reliance Power"],
  ["NLCINDIA.NS", "NLC India"], ["CESC.NS", "CESC"],
];

const UNIVERSES: Record<string, EnergyName[]> = { energy: ENERGY };

type Bar = { h: number; l: number; c: number; v: number };
export type VcpResult = {
  name: string; symbol: string; price: number;
  stage: "breakout" | "late" | "mid" | "none";
  legs: number[]; pivot: number; belowPivotPct: number; offHighPct: number;
  higherLows: boolean; trendOK: boolean; volDryUp: boolean;
};

async function fetchDaily(symbol: string): Promise<{ price: number | null; rows: Bar[] }> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const r = (await res.json())?.chart?.result?.[0];
  if (!r) throw new Error("no result");
  const q = r.indicators?.quote?.[0] ?? {}, ts: number[] = r.timestamp ?? [], rows: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], vol = q.volume?.[i];
    if ([o, h, l, c].every((x) => typeof x === "number" && Number.isFinite(x)))
      rows.push({ h, l, c, v: typeof vol === "number" ? vol : 0 });
  }
  return { price: r.meta?.regularMarketPrice ?? rows.at(-1)?.c ?? null, rows };
}

function sma(arr: number[], p: number, end: number): number | null {
  if (end - p + 1 < 0 || end >= arr.length) return null;
  let s = 0; for (let i = end - p + 1; i <= end; i++) s += arr[i]; return s / p;
}

// i is a local extreme if vals[i] compares favourably (cmp) with every neighbour
// within `order` bars each side.
function localExtrema(vals: number[], order: number, cmp: (a: number, b: number) => boolean): number[] {
  const idx: number[] = [];
  for (let i = order; i < vals.length - order; i++) {
    let ok = true;
    for (let j = i - order; j <= i + order; j++) { if (j !== i && !cmp(vals[i], vals[j])) { ok = false; break; } }
    if (ok) idx.push(i);
  }
  return idx;
}

const TIGHTEN = 0.85; // each leg must be ≤ 85% of the previous (proportional tightening)

function analyze(name: string, symbol: string, price: number, rows: Bar[]): VcpResult | null {
  if (rows.length < 120) return null;
  const highs = rows.map((r) => r.h), lows = rows.map((r) => r.l), closes = rows.map((r) => r.c), vols = rows.map((r) => r.v);
  const end = rows.length - 1;

  const s50 = sma(closes, 50, end), s200 = sma(closes, 200, end), s200prev = sma(closes, 200, end - 20);
  const trendOK = s50 != null && s200 != null && s200prev != null && price > s50 && price > s200 && s200 > s200prev;

  const hi52 = Math.max(...highs);
  const offHigh = (hi52 - price) / hi52;

  const tops = localExtrema(highs, 3, (a, b) => a >= b);
  const bots = localExtrema(lows, 3, (a, b) => a <= b);
  const pts = [
    ...tops.slice(-8).map((i) => ({ i, val: highs[i], type: "peak" as const })),
    ...bots.slice(-8).map((i) => ({ i, val: lows[i], type: "trough" as const })),
  ].sort((a, b) => b.i - a.i); // most recent first

  const seq: typeof pts = [];
  let lastPeak: boolean | null = null;
  for (const p of pts) {
    if (lastPeak === null && p.type === "peak") { seq.push(p); lastPeak = true; }
    else if (lastPeak === true && p.type === "trough") { seq.push(p); lastPeak = false; }
    else if (lastPeak === false && p.type === "peak") { seq.push(p); lastPeak = true; }
  }
  const peaks = seq.filter((s) => s.type === "peak");   // [0] = most recent
  const troughs = seq.filter((s) => s.type === "trough");
  if (peaks.length < 2 || troughs.length < 1) return null;

  const legPct = (pk: { val: number }, tr: { val: number }) => ((pk.val - tr.val) / pk.val) * 100;
  const pivot = peaks[0].val;                 // most recent swing high = breakout pivot
  const nearPivot = (pivot - price) / pivot;
  const lastTrough = troughs[0].val;

  const avgVol = (a: number, b: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b); let s = 0, c = 0;
    for (let i = lo; i <= hi; i++) { s += vols[i]; c++; } return c ? s / c : 0;
  };
  const volDryUp = troughs.length >= 2 && avgVol(troughs[troughs.length - 1].i, end) < avgVol(0, troughs[troughs.length - 1].i);

  let stage: VcpResult["stage"] = "none";
  let legs: number[] = [];
  let higherLows = false;

  // Full 3-leg VCP: 4 peaks, 3 troughs.
  if (peaks.length >= 4 && troughs.length >= 3) {
    const [p4, p3, p2, p1] = [peaks[0], peaks[1], peaks[2], peaks[3]];
    const [t3, t2, t1] = [troughs[0], troughs[1], troughs[2]];
    const ordered = p1.i < t1.i && t1.i < p2.i && p2.i < t2.i && t2.i < p3.i && p3.i < t3.i && t3.i < p4.i;
    const L1 = legPct(p1, t1), L2 = legPct(p2, t2), L3 = legPct(p3, t3);
    higherLows = t1.val < t2.val && t2.val < t3.val;
    const tightening = L2 <= L1 * TIGHTEN && L3 <= L2 * TIGHTEN;
    legs = [L1, L2, L3].map((x) => +x.toFixed(1));
    if (ordered && higherLows && tightening && L1 > 0 && L2 > 0 && L3 > 0 && trendOK && offHigh <= 0.20 && price > lastTrough) {
      stage = price > pivot * 1.005 ? "breakout" : "late";
    }
  }

  // Mid-base: 2 legs formed (3 peaks, 2 troughs), 3rd not yet.
  if (stage === "none" && peaks.length >= 3 && troughs.length >= 2) {
    const [p3, p2, p1] = [peaks[0], peaks[1], peaks[2]];
    const [t2, t1] = [troughs[0], troughs[1]];
    const ordered = p1.i < t1.i && t1.i < p2.i && p2.i < t2.i && t2.i < p3.i;
    const L1 = legPct(p1, t1), L2 = legPct(p2, t2);
    higherLows = t1.val < t2.val;
    const tightening = L2 <= L1 * TIGHTEN;
    legs = [L1, L2].map((x) => +x.toFixed(1));
    if (ordered && higherLows && tightening && L1 > 0 && L2 > 0 && trendOK && offHigh <= 0.20 && price > lastTrough) {
      stage = "mid";
    }
  }

  return {
    name, symbol, price: +price.toFixed(2), stage, legs,
    pivot: +pivot.toFixed(2), belowPivotPct: +(nearPivot * 100).toFixed(1), offHighPct: +(offHigh * 100).toFixed(1),
    higherLows, trendOK, volDryUp,
  };
}

const STAGE_RANK: Record<VcpResult["stage"], number> = { breakout: 0, late: 1, mid: 2, none: 3 };

// ---- Persisted snapshot (single row), same pattern as adityaSector ----
export const get = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("vcpScan").collect();
    if (!rows.length) return null;
    const latest = rows.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    return { updatedAt: latest.updatedAt, payload: latest.payload };
  },
});

export const push = mutation({
  args: { updatedAt: v.number(), payload: v.string() },
  handler: async (ctx, { updatedAt, payload }) => {
    for (const row of await ctx.db.query("vcpScan").collect()) await ctx.db.delete(row._id);
    await ctx.db.insert("vcpScan", { updatedAt, payload });
  },
});

// Scan a universe live and persist the snapshot.
export const runScan = action({
  args: { universe: v.optional(v.string()) },
  handler: async (ctx, { universe = "energy" }): Promise<{ scanned: number; candidates: number }> => {
    const list = UNIVERSES[universe] ?? ENERGY;
    const settled = await Promise.allSettled(
      list.map(async ([symbol, name]) => {
        const { price, rows } = await fetchDaily(symbol);
        if (price == null) return null;
        return analyze(name, symbol, price, rows);
      }),
    );
    const results: VcpResult[] = [];
    for (const s of settled) if (s.status === "fulfilled" && s.value) results.push(s.value);
    results.sort((a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage] || a.belowPivotPct - b.belowPivotPct);

    const scannedAtIST = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
    const payload = JSON.stringify({ scannedAtIST, universe, results });
    await ctx.runMutation(api.vcp.push, { updatedAt: Date.now(), payload });
    return { scanned: results.length, candidates: results.filter((r) => r.stage !== "none").length };
  },
});
