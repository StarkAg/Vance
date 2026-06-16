import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { money, fmtDate } from "../lib/format";
import { Modal } from "./ui";
import { Icon } from "./icons";

type Kind = "swing" | "yearly";
type Tab = "orders" | "holdings";
// Unified row for both sources; orders carry side/status/date, holdings don't.
type Row = {
  id: string;
  symbol: string;
  qty: number;
  price: number;
  exchange: "NSE" | "BSE";
  side?: "BUY" | "SELL";
  status?: string;
  date?: string;
};

const today = () => new Date().toISOString().slice(0, 10);

// Add selected Groww data as open trades — no OCR. Orders = accumulated order
// history (persisted on each sync, since the API only keeps today's book).
// Holdings = current positions.
export default function GrowwOrders({ kind, open, onClose }: { kind: Kind; open: boolean; onClose: () => void }) {
  const apiMod = kind === "swing" ? api.swing : api.yearly;
  const add = useMutation(apiMod.add);
  const syncOrders = useAction(api.groww.syncOrders);
  const fetchHoldings = useAction(api.groww.holdings);
  const savedOrders = useQuery(api.growwStore.savedOrders);

  const [tab, setTab] = useState<Tab>("orders");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [holdingRows, setHoldingRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  // Orders tab is driven by the reactive saved-history query; holdings by a fetch.
  const rows: Row[] = useMemo(
    () =>
      tab === "orders"
        ? (savedOrders ?? []).map((o) => ({
            id: o.growwOrderId,
            symbol: o.symbol,
            qty: o.qty,
            price: o.price,
            exchange: o.exchange === "BSE" ? "BSE" : "NSE",
            side: o.side === "SELL" ? "SELL" : "BUY",
            status: o.status,
            date: o.date,
          }))
        : holdingRows,
    [tab, savedOrders, holdingRows],
  );

  const loadHoldings = async () => {
    setLoading(true);
    setErr(null);
    setHoldingRows([]);
    try {
      setHoldingRows(await fetchHoldings({}));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load holdings");
    } finally {
      setLoading(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setErr(null);
    try {
      await syncOrders({});
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't sync orders");
    } finally {
      setSyncing(false);
    }
  };

  // On open / tab switch: sync today's orders, or fetch holdings.
  useEffect(() => {
    if (!open) { setHoldingRows([]); setErr(null); setPicked({}); return; }
    if (tab === "orders") void sync();
    else void loadHoldings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  // Default selection: holdings all on; orders default to executed BUYs. Preserve
  // any toggles the user already made as the reactive list updates.
  const idsKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    setPicked((prev) => {
      const next: Record<string, boolean> = {};
      for (const r of rows) {
        next[r.id] = r.id in prev
          ? prev[r.id]
          : tab === "holdings"
            ? true
            : r.side === "BUY" && /EXECUT|COMPLETE|FILLED/i.test(r.status ?? "");
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, tab]);

  // Orders: query still loading and nothing to show yet. Holdings: fetch in flight.
  const showLoading = tab === "orders" ? savedOrders === undefined && rows.length === 0 : loading;
  const toggle = (id: string) => setPicked((p) => ({ ...p, [id]: !p[id] }));
  const selected = useMemo(() => rows.filter((r) => picked[r.id]), [rows, picked]);
  const allOn = rows.length > 0 && selected.length === rows.length;
  const invested = selected.reduce((s, r) => s + r.qty * r.price, 0);

  const addSelected = async () => {
    if (!selected.length) return;
    setSaving(true);
    try {
      for (const r of selected) {
        await add({
          buyDate: r.date || today(),
          // Prefix the exchange so live price refresh (quoteSymbol) can resolve it.
          name: `${r.exchange}:${r.symbol}`,
          qty: r.qty,
          buyPrice: r.price,
          currentPrice: r.price,
          charges: 0,
          ...(kind === "swing" ? { feedback: undefined } : {}),
        } as Parameters<typeof add>[0]);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add trades");
    } finally {
      setSaving(false);
    }
  };

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${tab === id ? "bg-panel2 text-slate-100" : "text-muted hover:text-slate-200"}`}
    >
      {label}
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title="Add from Groww">
      <div className="mb-3 flex gap-1 rounded border border-line bg-panel/60 p-1">
        {tabBtn("orders", "Orders (today)")}
        {tabBtn("holdings", "Holdings (past buys)")}
      </div>

      {showLoading && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted">
          <Icon name="reset" className="h-4 w-4 animate-spin" />
          Loading your Groww {tab}…
        </div>
      )}

      {!showLoading && err && (
        <div className="space-y-3">
          <div className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</div>
          <button className="btn-ghost" onClick={() => (tab === "orders" ? void sync() : void loadHoldings())}>
            <Icon name="reset" className="h-4 w-4" />
            Retry
          </button>
        </div>
      )}

      {!showLoading && !err && (
        <div className="space-y-3">
          {tab === "orders" && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted">
              <span>{syncing ? "Syncing today's orders…" : "Orders sync on open + daily; history is saved here."}</span>
              <button className="inline-flex items-center gap-1 text-brand hover:text-slate-200 disabled:opacity-50" onClick={() => void sync()} disabled={syncing}>
                <Icon name="reset" className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                Sync now
              </button>
            </div>
          )}
          {rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">
              {tab === "orders" ? (
                <>No saved orders yet. Groww's API only exposes the <span className="text-slate-200">current day's</span> orders, so they're captured here on each sync — place orders and they'll accumulate. Use <span className="text-slate-200">Holdings</span> for existing past buys.</>
              ) : (
                <>No holdings found in your Groww account.</>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={(e) => setPicked(Object.fromEntries(rows.map((r) => [r.id, e.target.checked])))}
                    className="h-4 w-4 accent-[#d8b45a]"
                  />
                  Select all ({rows.length})
                </label>
                <span className="text-xs text-muted">
                  <span className="text-slate-200">{selected.length}</span> selected · {money(invested)}
                </span>
              </div>

              <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                {rows.map((r) => {
                  const on = picked[r.id];
                  return (
                    <label
                      key={r.id}
                      className={`flex cursor-pointer items-center gap-3 rounded border bg-panel2/40 px-3 py-2.5 ${on ? "border-line" : "border-line/40 opacity-60"}`}
                    >
                      <input type="checkbox" checked={!!on} onChange={() => toggle(r.id)} className="h-4 w-4 shrink-0 accent-[#d8b45a]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {r.side && <span className={`chip shrink-0 ${r.side === "BUY" ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>{r.side}</span>}
                          <span className="truncate font-semibold text-slate-100">{r.symbol}</span>
                          <span className="chip shrink-0 bg-panel text-muted">{r.exchange}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted">
                          {r.qty} qty · {money(r.price)}
                          {r.date && <span> · {fmtDate(r.date)}</span>}
                          {r.status && <span className="ml-1 text-muted/70">· {r.status.toLowerCase()}</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs text-muted">{tab === "holdings" ? "Invested" : "Value"}</div>
                        <div className="font-semibold text-slate-100">{money(r.qty * r.price)}</div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:justify-end">
                <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
                <button className="btn-brand" onClick={() => void addSelected()} disabled={saving || !selected.length}>
                  <Icon name="plus" className="h-4 w-4" />
                  {saving ? "Adding…" : `Add to buy (${selected.length})`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
