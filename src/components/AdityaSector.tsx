import { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

type Ranked = { sector: string; change: number; rank: number };
type RankRow = {
  sector: string;
  d1: number | null;
  d5: number | null;
  d1Rank: number | null;
  d5Rank: number | null;
  inBoth: boolean;
  score: number;
  bullRank: number;
};
type Payload = { d1: Ranked[]; d5: Ranked[]; both: string[]; ranking: RankRow[]; fetchedAtIST: string };
type TrendNews = { sector: string; title: string; url: string; source: string; publishedAt: string };

const pctClass = (n: number | null | undefined) =>
  n == null ? "text-muted" : n > 0 ? "text-good" : n < 0 ? "text-bad" : "text-slate-300";
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n}%`);

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export default function AdityaSector() {
  const snap = useQuery(api.adityaSector.get);
  const runScan = useAction(api.sectorScan.runAdityaScan);
  const fetchTrendNews = useAction(api.adityaSector.trendNews);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newsBySector, setNewsBySector] = useState<Record<string, TrendNews>>({});
  const [newsLoading, setNewsLoading] = useState(false);

  const data = useMemo<Payload | null>(() => {
    if (!snap?.payload) return null;
    try {
      return JSON.parse(snap.payload) as Payload;
    } catch {
      return null;
    }
  }, [snap]);

  async function onRefresh() {
    setRefreshing(true);
    setErr(null);
    try {
      await runScan({});
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setRefreshing(false);
    }
  }

  const stale = !!snap && Date.now() - snap.updatedAt > 45 * 60000;
  const both = useMemo(() => new Set(data?.both ?? []), [data]);
  const highlightedSectors = useMemo(
    () => (data?.ranking ?? []).filter((row) => row.inBoth).map((row) => row.sector).slice(0, 6),
    [data],
  );
  const newsKey = highlightedSectors.join("\u0001");

  useEffect(() => {
    const sectors = newsKey ? newsKey.split("\u0001") : [];
    if (!sectors.length) {
      setNewsBySector({});
      return;
    }
    let cancelled = false;
    setNewsLoading(true);
    void fetchTrendNews({ sectors })
      .then((items) => {
        if (!cancelled) setNewsBySector(Object.fromEntries(items.map((item) => [item.sector, item])));
      })
      .catch(() => {
        if (!cancelled) setNewsBySector({});
      })
      .finally(() => {
        if (!cancelled) setNewsLoading(false);
      });
    return () => { cancelled = true; };
  }, [fetchTrendNews, newsKey]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold text-slate-100">Aditya&apos;s Sector</h2>
        <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-end sm:gap-3">
          {data && (
            <span className={`min-w-0 truncate text-[11px] sm:text-xs ${stale ? "text-bad" : "text-muted"}`}>
              {data.fetchedAtIST} · {ago(snap!.updatedAt)}
              {stale ? " · stale" : ""}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="min-h-10 shrink-0 rounded-lg bg-brand/15 px-3 text-sm font-semibold text-brand transition-colors hover:bg-brand/25 disabled:opacity-50"
          >
            {refreshing ? "Scanning…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="card flex items-start gap-2 p-3 text-xs sm:items-center sm:gap-3 sm:p-4 sm:text-sm">
        <span className="mt-0.5 shrink-0 text-brand" aria-hidden="true">◆</span>
        <span className="text-slate-300">
          1-Day top-10 vs 5-Day top-10 sectors. Sectors in <span className="font-semibold text-brand">both</span> lists are
          confirmed uptrends — a 1-day pop without a 5-day trend behind it isn&apos;t real.
        </span>
      </div>

      {err && <div className="card border-bad/40 p-3 text-sm text-bad">{err}</div>}

      {snap === undefined ? (
        <div className="card p-4 text-sm text-muted sm:p-5">Loading…</div>
      ) : !data ? (
        <div className="card p-4 text-sm text-muted sm:p-5">
          No snapshot yet. Hit <span className="font-semibold text-brand">Refresh</span> to pull the latest sector returns.
        </div>
      ) : (
        <>
          {/* Bullishness ranking — confirmed (in-both) sectors float to the top */}
          <div className="card min-w-0 p-3 sm:p-4">
            <div className="mb-1 text-sm font-semibold text-slate-100">Bullishness ranking</div>
            <div className="mb-3 text-[11px] leading-4 text-muted sm:text-xs">
              Ranked by combined top-10 strength · ◆ = in both 1D &amp; 5D top-10 (confirmed uptrend)
            </div>
            <div className="space-y-2 sm:hidden">
              {data.ranking.map((r) => {
                const news = r.inBoth ? newsBySector[r.sector] : null;
                return (
                  <div key={r.sector} className={`rounded-lg border border-line/70 p-3 ${r.inBoth ? "bg-brand/10" : "bg-panel2/30"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <span className="w-5 shrink-0 pt-0.5 text-xs tabular-nums text-muted">{r.bullRank}</span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-100">
                            {r.inBoth && <span className="mr-1 text-brand">◆</span>}
                            {r.sector}
                          </div>
                          {news ? (
                            <a href={news.url} target="_blank" rel="noreferrer" className="mt-1 block line-clamp-2 text-[11px] leading-4 text-slate-300 hover:text-brand hover:underline">
                              {news.title}
                            </a>
                          ) : r.inBoth ? (
                            <div className="mt-1 text-[11px] text-muted">{newsLoading ? "Loading latest news…" : "No recent sector news"}</div>
                          ) : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={`text-sm font-semibold tabular-nums ${pctClass(r.d1)}`}>{pct(r.d1)}</div>
                        <div className={`text-xs tabular-nums ${pctClass(r.d5)}`}>{pct(r.d5)} <span className="text-muted">5D</span></div>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-3 pl-7 text-[11px] text-muted">
                      <span>1D rank <b className="font-medium text-slate-300">{r.d1Rank ?? "—"}</b></span>
                      <span>5D rank <b className="font-medium text-slate-300">{r.d5Rank ?? "—"}</b></span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 pr-2 font-medium">#</th>
                    <th className="py-1 px-2 font-medium">Sector</th>
                    <th className="py-1 px-2 text-right font-medium">1D</th>
                    <th className="py-1 px-2 text-right font-medium">5D</th>
                    <th className="py-1 px-2 text-right font-medium">1D rank</th>
                    <th className="py-1 px-2 text-right font-medium">5D rank</th>
                    <th className="py-1 pl-2 font-medium">News context</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ranking.map((r) => (
                    <tr key={r.sector} className={`border-t border-line/60 ${r.inBoth ? "bg-brand/10" : ""}`}>
                      <td className="py-1.5 pr-2 tabular-nums text-muted">{r.bullRank}</td>
                      <td className="py-1.5 px-2 font-medium text-slate-200">
                        {r.inBoth && <span className="mr-1 text-brand">◆</span>}
                        {r.sector}
                      </td>
                      <td className={`py-1.5 px-2 text-right tabular-nums ${pctClass(r.d1)}`}>{pct(r.d1)}</td>
                      <td className={`py-1.5 px-2 text-right tabular-nums ${pctClass(r.d5)}`}>{pct(r.d5)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-muted">{r.d1Rank ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-muted">{r.d5Rank ?? "—"}</td>
                      <td className="py-1.5 pl-2 text-xs text-slate-300">
                        {r.inBoth ? (() => {
                          const news = newsBySector[r.sector];
                          if (!news) return newsLoading ? "Loading latest news…" : "No recent sector news found";
                          return (
                            <a href={news.url} target="_blank" rel="noreferrer" className="text-slate-200 hover:text-brand hover:underline" title={news.title}>
                              {news.title}{news.source ? <span className="text-muted"> · {news.source}</span> : null}
                            </a>
                          );
                        })() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* The two source lists, side by side */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Top10 title="1-Day Top 10" rows={data.d1} both={both} />
            <Top10 title="5-Day Top 10" rows={data.d5} both={both} />
          </div>
        </>
      )}

      <p className="px-1 text-xs text-muted">
        Heuristic sector screen from Moneycontrol data — not investment advice. Always check the actual chart before acting.
      </p>
    </div>
  );
}

function Top10({ title, rows, both }: { title: string; rows: Ranked[]; both: Set<string> }) {
  return (
    <div className="card min-w-0 p-3 sm:p-4">
      <div className="mb-2 text-sm font-semibold text-slate-100">{title}</div>
      <div className="space-y-1.5 sm:hidden">
        {rows.map((r) => {
          const inBoth = both.has(r.sector);
          return (
            <div key={r.sector} className={`flex min-h-10 items-center gap-2 rounded-md px-2.5 ${inBoth ? "bg-brand/10" : "bg-panel2/30"}`}>
              <span className="w-4 shrink-0 text-xs tabular-nums text-muted">{r.rank}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">
                {inBoth && <span className="mr-1 text-brand">◆</span>}
                {r.sector}
              </span>
              <span className={`shrink-0 text-sm font-semibold tabular-nums ${pctClass(r.change)}`}>{pct(r.change)}</span>
            </div>
          );
        })}
      </div>
      <div className="hidden sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 pr-2 font-medium">#</th>
              <th className="py-1 px-2 font-medium">Sector</th>
              <th className="py-1 pl-2 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const inBoth = both.has(r.sector);
              return (
                <tr key={r.sector} className={`border-t border-line/60 ${inBoth ? "bg-brand/10" : ""}`}>
                  <td className="py-1.5 pr-2 tabular-nums text-muted">{r.rank}</td>
                  <td className="py-1.5 px-2 font-medium text-slate-200">
                    {inBoth && <span className="mr-1 text-brand">◆</span>}
                    {r.sector}
                  </td>
                  <td className={`py-1.5 pl-2 text-right tabular-nums font-semibold ${pctClass(r.change)}`}>{pct(r.change)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
