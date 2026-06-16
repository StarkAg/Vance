import { useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

export type Holding = { id: string; symbol: string; qty: number; price: number; exchange: "NSE" | "BSE" };
export type HoldingRow = Holding & { ltp: number | null; invested: number; value: number; pnl: number; pnlPct: number };

export const yahooSymbol = (h: Holding) => `${h.symbol}.${h.exchange === "BSE" ? "BO" : "NS"}`;

// Live Groww holdings (qty + avg from Groww) marked-to-market with Yahoo prices.
// Shared by the Holdings tab and the Dashboard so both show the same real numbers.
export function useGrowwHoldings() {
  const fetchHoldings = useAction(api.groww.holdings);
  const fetchQuotes = useAction(api.quotes.latest);

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [pricing, setPricing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const h = (await fetchHoldings({})) as Holding[];
      setHoldings(h);
      setPricing(true);
      const quotes = await fetchQuotes({ symbols: h.map(yahooSymbol) }).catch(() => []);
      const m: Record<string, number> = {};
      for (const q of quotes) if (q.ok) m[q.symbol] = q.price;
      setPrices(m);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load holdings");
    } finally {
      setLoading(false);
      setPricing(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const rows = useMemo<HoldingRow[]>(
    () =>
      holdings.map((h) => {
        const ltp = prices[yahooSymbol(h).toUpperCase()] ?? null;
        const invested = h.qty * h.price;
        const value = ltp != null ? h.qty * ltp : invested;
        const pnl = ltp != null ? (ltp - h.price) * h.qty : 0;
        const pnlPct = ltp != null && h.price ? (ltp - h.price) / h.price : 0;
        return { ...h, ltp, invested, value, pnl, pnlPct };
      }),
    [holdings, prices],
  );

  const totals = useMemo(() => {
    let invested = 0, value = 0;
    for (const r of rows) { invested += r.invested; value += r.value; }
    const pnl = value - invested;
    return { invested, value, pnl, pnlPct: invested ? pnl / invested : 0, count: rows.length };
  }, [rows]);

  return { rows, totals, loading, pricing, err, reload: load };
}
