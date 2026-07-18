import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Icon } from "./icons";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import { useAccount } from "../lib/account";

// Each row is computed by convex/groww.ts → pollPosition (booked + live if-held).
type Trade = {
  name: string;
  symbol: string;
  qty: number;
  buy: number;
  sell: number | null;
  ltp: number;
  booked: number | null;
  ifHeld: number;
  delta: number | null; // booked − ifHeld (positive = selling beat holding)
  buyDate: string;
  sellDate: string | null;
  note: string | null;
};
type Payload = { trades: Trade[]; marketOpen: boolean; fetchedAtIST: string };

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${inr(Math.abs(n))}`;
const cls = (n: number) => (n > 0 ? "text-good" : n < 0 ? "text-bad" : "text-slate-300");
const pctStr = (n: number, dp = 0) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(dp)}%`;

// Calendar days held (first buy → final sell), floored at 1 for intraday.
function daysHeld(buyDate: string, sellDate: string | null): number {
  if (!sellDate) return 0;
  const d = Math.round((new Date(sellDate).getTime() - new Date(buyDate).getTime()) / 86400000);
  return Math.max(1, d);
}

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export default function Scorecard() {
  const { account } = useAccount();
  useLiveRefresh(5000); // poll every 5 s — Groww Live Data cap is 300 req/min
  const snap = useQuery(api.growwStore.positionSnapshot);
  const data = useMemo<Payload | null>(() => {
    if (!snap?.payload) return null;
    try { return JSON.parse(snap.payload) as Payload; } catch { return null; }
  }, [snap]);

  const totals = useMemo(() => {
    const t = data?.trades ?? [];
    const booked = t.reduce((s, x) => s + (x.booked ?? 0), 0);
    const ifHeld = t.reduce((s, x) => s + x.ifHeld, 0);
    const closed = t.filter((x) => x.sell != null);
    const invested = closed.reduce((s, x) => s + x.buy * x.qty, 0);
    const returnPct = invested ? (booked / invested) * 100 : 0;
    const totalDays = closed.reduce((s, x) => s + daysHeld(x.buyDate, x.sellDate), 0);
    const avgDays = closed.length ? totalDays / closed.length : 0;
    // capital-weighted per-day return: total booked / (Σ invested·days)
    const investedDays = closed.reduce((s, x) => s + x.buy * x.qty * daysHeld(x.buyDate, x.sellDate), 0);
    const perDayPct = investedDays ? (booked / investedDays) * 100 : 0;
    return { booked, ifHeld, edge: booked - ifHeld, invested, returnPct, avgDays, perDayPct };
  }, [data]);

  if (account === "aditya") {
    return <Shell><div className="card p-5 text-sm text-muted">Scorecard is only recorded for Harsh&apos;s account so far. Aditya&apos;s trade history isn&apos;t synced yet — switch to Harsh to view it.</div></Shell>;
  }
  if (snap === undefined) return <Shell><div className="text-sm text-muted">Loading…</div></Shell>;
  if (!data || data.trades.length === 0) {
    return <Shell><div className="card p-5 text-sm text-muted">No scorecard trades yet.</div></Shell>;
  }

  return (
    <Shell meta={<span className="text-muted">{data.fetchedAtIST} · marks {ago(snap!.updatedAt)}</span>}>
      {/* Headline cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card label="You booked" value={signed(totals.booked)} tone={cls(totals.booked)} sub={`${pctStr(totals.returnPct)} on ${inr(totals.invested)} deployed`} />
        <Card label="If you'd held to now" value={signed(totals.ifHeld)} tone={cls(totals.ifHeld)} sub="same trades, marked live" />
        <Card label="Avg per day" value={pctStr(totals.perDayPct, 1)} tone={cls(totals.perDayPct)} sub={`held ${totals.avgDays.toFixed(1)} days avg`} />
      </div>

      {/* Per-trade list */}
      <div className="card min-w-0 p-3 sm:p-4">
        <div className="mb-3 text-xs text-muted">Booked = what you locked · If-held = (live − sell) · verdict = exit vs holding</div>

        {/* Mobile cards */}
        <div className="space-y-2 sm:hidden">
          {data.trades.map((t) => {
            const better = t.delta != null && t.delta >= 0;
            const ret = t.sell != null ? ((t.sell - t.buy) / t.buy) * 100 : null;
            const days = daysHeld(t.buyDate, t.sellDate);
            const perDay = ret != null && days ? ret / days : null;
            return (
              <div key={t.symbol} className="rounded-lg border border-line/60 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-slate-100 text-sm leading-tight">
                    {t.name}
                    {t.note && <span className="ml-1 text-[10px] text-muted">ⓘ</span>}
                  </span>
                  {t.delta != null && (
                    <span className={`inline-flex items-center gap-0.5 text-xs font-bold shrink-0 ${better ? "text-good" : "text-bad"}`}>
                      <Icon name={better ? "check" : "close"} className="h-3 w-3 shrink-0" />
                      {better ? `+${inr(t.delta)}` : `−${inr(Math.abs(t.delta))}`}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted tabular-nums">
                  Buy {t.buy} · Sold {t.sell ?? "—"} · LTP {t.ltp || "—"}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-base font-bold tabular-nums ${cls(t.booked ?? 0)}`}>
                    {t.booked != null ? signed(t.booked) : "—"}
                  </span>
                  <span className="text-xs text-muted tabular-nums">
                    {ret != null ? pctStr(ret) : "—"}
                    {days ? ` · ${days}d` : ""}
                    {perDay != null ? ` · ${pctStr(perDay, 1)}/d` : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">If held</span>
                  <span className={`tabular-nums font-medium ${cls(t.ifHeld)}`}>{signed(t.ifHeld)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 pr-2 font-medium">Contract</th>
                <th className="py-1 px-2 text-right font-medium">Buy</th>
                <th className="py-1 px-2 text-right font-medium">Sold</th>
                <th className="py-1 px-2 text-right font-medium">LTP</th>
                <th className="py-1 px-2 text-right font-medium">Booked</th>
                <th className="py-1 px-2 text-right font-medium">Return</th>
                <th className="py-1 px-2 text-right font-medium">Days</th>
                <th className="py-1 px-2 text-right font-medium">%/day</th>
                <th className="py-1 px-2 text-right font-medium">If held</th>
                <th className="py-1 pl-2 text-right font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {data.trades.map((t) => {
                const better = t.delta != null && t.delta >= 0;
                const ret = t.sell != null ? ((t.sell - t.buy) / t.buy) * 100 : null;
                const days = daysHeld(t.buyDate, t.sellDate);
                const perDay = ret != null && days ? ret / days : null;
                return (
                  <tr key={t.symbol} className="border-t border-line/60">
                    <td className="py-1.5 pr-2 font-medium text-slate-200">
                      {t.name}
                      {t.note && <span className="ml-1 text-[10px] text-muted">ⓘ</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-300">{t.buy}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-300">{t.sell ?? "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-400">{t.ltp || "—"}</td>
                    <td className={`py-1.5 px-2 text-right font-semibold tabular-nums ${cls(t.booked ?? 0)}`}>{t.booked != null ? signed(t.booked) : "—"}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums ${ret == null ? "text-muted" : cls(ret)}`}>{ret == null ? "—" : pctStr(ret)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted">{days || "—"}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums ${perDay == null ? "text-muted" : cls(perDay)}`}>{perDay == null ? "—" : pctStr(perDay)}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums ${cls(t.ifHeld)}`}>{signed(t.ifHeld)}</td>
                    <td className={`py-1.5 pl-2 text-right text-xs ${better ? "text-good" : "text-bad"}`}>
                      {t.delta == null ? (
                        "—"
                      ) : (
                        <span className="inline-flex items-center justify-end gap-1">
                          <Icon name={better ? "check" : "close"} className="h-3.5 w-3.5 shrink-0" />
                          {better ? `+${inr(t.delta)}` : `−${inr(Math.abs(t.delta))}`}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="px-1 text-xs text-muted">
        {totals.edge >= 0
          ? `Your exit discipline is worth ${signed(totals.edge)} vs. holding everything to now. Booking into strength has been your edge.`
          : `Holding would've added ${inr(Math.abs(totals.edge))} — the trend kept running. Worth reviewing your exit timing.`}
        {" "}Marks update live during market hours.
      </p>
    </Shell>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 text-2xl font-extrabold tabular-nums ${tone}`}>{value}</div>
      <div className="text-xs text-muted">{sub}</div>
    </div>
  );
}

function Shell({ children, meta }: { children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-slate-100">Trade Scorecard</h2>
        {meta && <span className="text-xs">{meta}</span>}
      </div>
      {children}
    </div>
  );
}
