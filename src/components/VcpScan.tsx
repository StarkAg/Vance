import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

type Stage = "breakout" | "late" | "mid" | "none";
type Result = {
  name: string; symbol: string; price: number;
  stage: Stage; legs: number[]; pivot: number;
  belowPivotPct: number; offHighPct: number;
  higherLows: boolean; trendOK: boolean; volDryUp: boolean;
};
type Payload = { scannedAtIST: string; universe: string; results: Result[] };

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const STAGE_META: Record<Stage, { label: string; cls: string }> = {
  breakout: { label: "Breakout", cls: "bg-good/20 text-good" },
  late: { label: "Late / at pivot", cls: "bg-brand/20 text-brand" },
  mid: { label: "Mid-base", cls: "bg-warn/20 text-warn" },
  none: { label: "—", cls: "bg-panel2 text-muted" },
};

export default function VcpScan() {
  const snap = useQuery(api.vcp.get);
  const runScan = useAction(api.vcp.runScan);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const data = useMemo<Payload | null>(() => {
    if (!snap?.payload) return null;
    try { return JSON.parse(snap.payload) as Payload; } catch { return null; }
  }, [snap]);

  async function onRefresh() {
    setRefreshing(true);
    setErr(null);
    try { await runScan({ universe: "energy" }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Scan failed"); }
    finally { setRefreshing(false); }
  }

  const stale = !!snap && Date.now() - snap.updatedAt > 6 * 60 * 60 * 1000; // daily data → 6h
  const candidates = useMemo(() => (data?.results ?? []).filter((r) => r.stage !== "none"), [data]);
  const inTrend = useMemo(
    () => (data?.results ?? []).filter((r) => r.stage === "none" && r.trendOK),
    [data],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-slate-100">VCP Scan · Energy</h2>
        <div className="flex items-center gap-3">
          {data && (
            <span className={stale ? "text-xs text-bad" : "text-xs text-muted"}>
              {data.scannedAtIST} · {ago(snap!.updatedAt)}{stale ? " · stale" : ""}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="rounded-lg bg-brand/15 px-3 py-1.5 text-sm font-semibold text-brand transition-colors hover:bg-brand/25 disabled:opacity-50"
          >
            {refreshing ? "Scanning…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="card p-3 text-sm text-slate-300">
        Minervini-style Volatility Contraction Pattern scan (higher lows + tightening pullbacks in a stage-2 uptrend near
        highs). <span className="font-semibold text-warn">Mid-base</span> = 2 legs formed, still building —
        watchlist, not an entry. <span className="font-semibold text-brand">Late</span> = coiled at the pivot.
      </div>

      {err && <div className="card border-bad/40 p-3 text-sm text-bad">{err}</div>}

      {snap === undefined ? (
        <div className="card p-5 text-sm text-muted">Loading…</div>
      ) : !data ? (
        <div className="card p-5 text-sm text-muted">
          No scan yet. Hit <span className="font-semibold text-brand">Refresh</span> to scan the energy universe.
        </div>
      ) : (
        <>
          <div className="card min-w-0 p-3 sm:p-4">
            <div className="mb-3 text-sm font-semibold text-slate-100">
              VCP candidates {candidates.length > 0 && <span className="text-muted">({candidates.length})</span>}
            </div>
            {candidates.length === 0 ? (
              <div className="text-sm text-muted">
                No stock is in a VCP right now. {inTrend.length} name{inTrend.length === 1 ? "" : "s"} in a valid uptrend
                near highs but without a clean contraction sequence (listed below).
              </div>
            ) : (
              <ResultTable rows={candidates} />
            )}
          </div>

          {inTrend.length > 0 && (
            <div className="card min-w-0 p-3 sm:p-4">
              <div className="mb-1 text-sm font-semibold text-slate-100">In uptrend near highs · no VCP yet</div>
              <div className="mb-3 text-xs text-muted">Stage-2 trend + within 20% of high, but legs aren&apos;t contracting cleanly.</div>
              <ResultTable rows={inTrend} muted />
            </div>
          )}
        </>
      )}

      <p className="px-1 text-xs text-muted">
        Mechanical pattern detection on Yahoo daily price/volume — not investment advice. Always check the actual chart before acting.
      </p>
    </div>
  );
}

function ResultTable({ rows, muted = false }: { rows: Result[]; muted?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 pr-2 font-medium">Stock</th>
            <th className="py-1 px-2 text-right font-medium">Price</th>
            <th className="py-1 px-2 font-medium">Stage</th>
            <th className="py-1 px-2 font-medium">Contractions</th>
            <th className="py-1 px-2 text-right font-medium">Pivot</th>
            <th className="py-1 px-2 text-right font-medium">Below</th>
            <th className="py-1 px-2 text-right font-medium">Off high</th>
            <th className="py-1 pl-2 text-right font-medium">Vol</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const meta = STAGE_META[r.stage];
            return (
              <tr key={r.symbol} className={`border-t border-line/60 ${!muted && r.stage !== "none" ? "bg-brand/5" : ""}`}>
                <td className="py-1.5 pr-2 font-medium text-slate-200">{r.name}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-slate-200">₹{r.price.toLocaleString("en-IN")}</td>
                <td className="py-1.5 px-2">
                  <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
                </td>
                <td className="py-1.5 px-2 tabular-nums text-muted">
                  {r.legs.length ? r.legs.map((l) => `${l}%`).join(" › ") : "—"}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-slate-300">₹{r.pivot.toLocaleString("en-IN")}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted">{r.belowPivotPct}%</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted">{r.offHighPct}%</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-muted">{r.volDryUp ? "dry" : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
