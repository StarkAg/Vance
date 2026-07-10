import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { money, fmtDate } from "../lib/format";
import { Modal } from "./ui";
import { Icon } from "./icons";

type Kind = "swing" | "yearly";
const today = () => new Date().toISOString().slice(0, 10);

// One full list of all Groww orders (the accumulated history — persisted on each
// sync, since the API only exposes the current trading day). Select & add as trades.
export default function GrowwOrders({ kind, open, onClose }: { kind: Kind; open: boolean; onClose: () => void }) {
  const apiMod = kind === "swing" ? api.swing : api.yearly;
  const add = useMutation(apiMod.add);
  const syncOrders = useAction(api.groww.syncOrders);
  const savedOrders = useQuery(api.growwStore.savedOrders);

  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    if (open) void sync();
    else { setErr(null); setPicked({}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const orders = useMemo(() => savedOrders ?? [], [savedOrders]);

  // Default-select executed BUY orders; preserve user toggles as the list updates.
  const idsKey = orders.map((o) => o.growwOrderId).join(",");
  useEffect(() => {
    setPicked((prev) => {
      const next: Record<string, boolean> = {};
      for (const o of orders) {
        next[o.growwOrderId] = o.growwOrderId in prev
          ? prev[o.growwOrderId]
          : o.side === "BUY" && /EXECUT|COMPLETE|FILLED/i.test(o.status ?? "");
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const loading = savedOrders === undefined;
  const toggle = (id: string) => setPicked((p) => ({ ...p, [id]: !p[id] }));
  const selected = useMemo(() => orders.filter((o) => picked[o.growwOrderId]), [orders, picked]);
  const allOn = orders.length > 0 && selected.length === orders.length;
  const value = selected.reduce((s, o) => s + o.qty * o.price, 0);

  const addSelected = async () => {
    if (!selected.length) return;
    setSaving(true);
    try {
      for (const o of selected) {
        await add({
          buyDate: o.date || today(),
          name: `${o.exchange === "BSE" ? "BSE" : "NSE"}:${o.symbol}`, // prefix so live price refresh resolves it
          qty: o.qty,
          buyPrice: o.price,
          currentPrice: o.price,
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

  return (
    <Modal open={open} onClose={onClose} title="Groww orders">
      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted">
          <Icon name="reset" className="h-4 w-4 animate-spin" />
          Loading orders…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>{syncing ? "Syncing latest orders…" : `${orders.length} order${orders.length === 1 ? "" : "s"} · synced on open + daily`}</span>
            <button className="inline-flex items-center gap-1 text-brand hover:text-stone-200 disabled:opacity-50" onClick={() => void sync()} disabled={syncing}>
              <Icon name="reset" className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              Sync now
            </button>
          </div>

          {err && <div className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</div>}

          {orders.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">
              No orders yet. Groww's API only exposes the <span className="text-stone-200">current trading day's</span> orders, so
              they're captured here on each sync (open + daily) and build up over time.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={(e) => setPicked(Object.fromEntries(orders.map((o) => [o.growwOrderId, e.target.checked])))}
                    className="h-4 w-4 accent-[#d8b45a]"
                  />
                  Select all ({orders.length})
                </label>
                <span className="text-xs text-muted">
                  <span className="text-stone-200">{selected.length}</span> selected · {money(value)}
                </span>
              </div>

              <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                {orders.map((o) => {
                  const on = picked[o.growwOrderId];
                  return (
                    <label
                      key={o.growwOrderId}
                      className={`flex cursor-pointer items-center gap-3 rounded border bg-panel2/40 px-3 py-2.5 ${on ? "border-line" : "border-line/40 opacity-60"}`}
                    >
                      <input type="checkbox" checked={!!on} onChange={() => toggle(o.growwOrderId)} className="h-4 w-4 shrink-0 accent-[#d8b45a]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`chip shrink-0 ${o.side === "BUY" ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>{o.side}</span>
                          <span className="truncate font-semibold text-stone-100">{o.symbol}</span>
                          <span className="chip shrink-0 bg-panel text-muted">{o.exchange}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted">
                          {o.qty} qty · {money(o.price)}
                          {o.date && <span> · {fmtDate(o.date)}</span>}
                          {o.status && <span className="ml-1 text-muted/70">· {o.status.toLowerCase()}</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs text-muted">Value</div>
                        <div className="font-semibold text-stone-100">{money(o.qty * o.price)}</div>
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
