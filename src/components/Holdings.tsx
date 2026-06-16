import { useMemo } from "react";
import { money, pct, signClass } from "../lib/format";
import { useGrowwHoldings } from "../lib/useGrowwHoldings";
import { Stat, Count } from "./ui";
import { Icon } from "./icons";

// Live Groww holdings, marked-to-market with Yahoo prices (Groww live-data is a
// paid add-on). Shows qty, avg, LTP, invested, current value and return.
export default function Holdings() {
  const { rows, totals, loading, err, reload } = useGrowwHoldings();
  const load = reload;

  const sorted = useMemo(() => [...rows].sort((a, b) => b.value - a.value), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-100">Holdings</h2>
        </div>
        <button className="btn-ghost" onClick={() => void load()} disabled={loading}>
          <Icon name="reset" className={loading ? "animate-spin" : ""} />
          {loading ? "Loading" : "Refresh"}
        </button>
      </div>

      {err && (
        <div className="card p-4">
          <div className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Invested" value={<Count value={totals.invested} format={money} />} sub={`${rows.length} holdings`} />
        <Stat label="Current value" value={<Count value={totals.value} format={money} />} sub="mark-to-market" />
        <Stat label="Total P/L" value={<Count value={totals.pnl} format={money} />} tone={totals.pnl >= 0 ? "good" : "bad"} sub={pct(totals.pnlPct)} />
        <Stat label="Return" value={<Count value={totals.pnlPct} format={pct} />} tone={totals.pnl >= 0 ? "good" : "bad"} sub="overall" />
      </div>

      <div className="card overflow-hidden xl:overflow-visible">
        {/* Mobile cards */}
        <div className="divide-y divide-line xl:hidden">
          {sorted.map((r) => (
            <div key={r.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold text-slate-100">{r.symbol}</span>
                    <span className="chip shrink-0 bg-panel text-muted">{r.exchange}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{r.qty} qty · avg {money(r.price)} · LTP {r.ltp != null ? money(r.ltp) : "—"}</div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold ${signClass(r.pnl)}`}>{money(r.pnl)}</div>
                  <div className={`text-xs ${signClass(r.pnl)}`}>{r.ltp != null ? pct(r.pnlPct) : "—"}</div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <Mini label="Invested" value={money(r.invested)} />
                <Mini label="Value" value={money(r.value)} />
              </div>
            </div>
          ))}
          {!loading && rows.length === 0 && !err && <div className="p-3 text-sm text-muted">No holdings found.</div>}
        </div>

        {/* Desktop table */}
        <div className="hidden xl:block xl:overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-panel2/60">
              <tr>
                <th className="th px-2 text-left">Stock</th>
                <th className="th px-2 text-right">Qty</th>
                <th className="th px-2 text-right">Avg ₹</th>
                <th className="th px-2 text-right">LTP</th>
                <th className="th px-2 text-right">Invested</th>
                <th className="th px-2 text-right">Value</th>
                <th className="th px-2 text-right">P/L</th>
                <th className="th px-2 text-right">Return</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="hover:bg-panel2/40">
                  <td className="td px-2 font-medium">
                    {r.symbol}<span className="chip ml-2 bg-panel text-muted">{r.exchange}</span>
                  </td>
                  <td className="td px-2 text-right">{r.qty}</td>
                  <td className="td px-2 text-right">{r.price}</td>
                  <td className="td px-2 text-right">{r.ltp != null ? r.ltp : "—"}</td>
                  <td className="td px-2 text-right">{money(r.invested)}</td>
                  <td className="td px-2 text-right">{money(r.value)}</td>
                  <td className={`td px-2 text-right ${signClass(r.pnl)}`}>{money(r.pnl)}</td>
                  <td className={`td px-2 text-right ${signClass(r.pnl)}`}>{r.ltp != null ? pct(r.pnlPct) : "—"}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && !err && (
                <tr><td className="td px-2 text-muted" colSpan={8}>No holdings found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-panel2/50 px-1.5 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="truncate font-semibold text-slate-100">{value}</div>
    </div>
  );
}
