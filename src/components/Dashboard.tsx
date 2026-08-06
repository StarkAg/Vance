import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import {
  Bar, BarChart, Cell, LabelList, Line, LineChart, XAxis, YAxis,
} from "recharts";
import { api } from "../../convex/_generated/api";
import { tradeCalc, type TradeRow } from "../lib/calc";
import { money, pct } from "../lib/format";
import { Stat, Count } from "./ui";

export default function Dashboard() {
  const swingData = useQuery(api.swing.list);
  const vcpSwingData = useQuery(api.vcpSwing.list);

  const swing = useMemo(() => (swingData ?? []) as TradeRow[], [swingData]);
  const vcpSwing = useMemo(() => (vcpSwingData ?? []) as TradeRow[], [vcpSwingData]);

  const swingC = useMemo(() => swing.map((r) => tradeCalc(r)), [swing]);
  const vcpSwingC = useMemo(() => vcpSwing.map((r) => tradeCalc(r)), [vcpSwing]);

  const agg = (arr: ReturnType<typeof tradeCalc>[]) => {
    let invested = 0, net = 0, value = 0, wins = 0, closed = 0, openInvested = 0, openCount = 0;
    for (const c of arr) {
      invested += c.invested; net += c.netProfit; value += c.netValue;
      if (c.closed) { closed++; if (c.netProfit > 0) wins++; }
      else { openInvested += c.invested; openCount++; }
    }
    return { invested, net, value, wins, closed, winRate: closed ? wins / closed : 0, openInvested, openCount };
  };
  const s = agg(swingC), v = agg(vcpSwingC);
  const combined = {
    invested: s.invested + v.invested,
    net: s.net + v.net,
    wins: s.wins + v.wins,
    closed: s.closed + v.closed,
    winRate: s.closed + v.closed ? (s.wins + v.wins) / (s.closed + v.closed) : 0,
    openInvested: s.openInvested + v.openInvested,
    openCount: s.openCount + v.openCount,
  };

  // Month-wise realized net P/L across the two active swing journals only.
  const monthly = useMemo(() => {
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const byMonth = new Map<string, number>();
    for (const r of [...swing, ...vcpSwing]) {
      const c = tradeCalc(r);
      if (!c.closed || !r.sellDate) continue;
      const key = r.sellDate.slice(0, 7); // YYYY-MM
      byMonth.set(key, (byMonth.get(key) ?? 0) + c.netProfit);
    }
    return [...byMonth.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, pnl]) => {
        const [yr, mo] = key.split("-");
        return { month: `${MONTHS[Number(mo) - 1]} '${yr.slice(2)}`, pnl: Math.round(pnl) };
      });
  }, [swing, vcpSwing]);

  // Y-axis domain with headroom on both ends so value labels never clip
  const pnlDomain = useMemo(() => {
    const vals = monthly.map((d) => d.pnl);
    const max = Math.max(0, ...vals);
    const min = Math.min(0, ...vals);
    const pad = Math.max(80, (max - min) * 0.22);
    return [Math.round(min - pad), Math.round(max + pad)] as [number, number];
  }, [monthly]);

  // Cumulative P/L across News Swing and VCP Swing, by sell date.
  const equity = useMemo(() => {
    const closed = [...swing, ...vcpSwing]
      .map((r) => ({ r, c: tradeCalc(r) }))
      .filter(({ c }) => c.closed)
      .sort((a, b) => (a.r.sellDate! < b.r.sellDate! ? -1 : 1));
    return closed.map(({ r }, i) => ({
      date: r.sellDate!.slice(5),
      pnl: Math.round(closed.slice(0, i + 1).reduce((sum, { c }) => sum + c.netProfit, 0)),
    }));
  }, [swing, vcpSwing]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-100">Dashboard</h2>
      </div>

      <div className="card overflow-hidden">
        <StrategySummary title="News Swing + VCP Swing details" totals={combined} />
      </div>

      <div className="card min-w-0 p-3 sm:p-4">
        <div className="mb-2 text-sm font-semibold text-slate-100">News Swing &amp; VCP Swing equity curve (cumulative net P/L)</div>
        {equity.length ? (
          <ChartBox>
            {({ width, height }) => (
              <LineChart width={width} height={height} data={equity} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
                <XAxis dataKey="date" stroke="#9a9a9a" fontSize={11} minTickGap={24} />
                <YAxis stroke="#9a9a9a" fontSize={11} width={42} />
                <Line type="monotone" dataKey="pnl" stroke="#d8b45a" strokeWidth={2} dot={false} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
              </LineChart>
            )}
          </ChartBox>
        ) : (
          <div className="h-52 min-w-0 sm:h-64"><Empty /></div>
        )}
      </div>

      <div className="card min-w-0 p-3 sm:p-4">
        <div className="mb-2 text-sm font-semibold text-slate-100">News Swing &amp; VCP Swing realized P/L</div>
        {monthly.length ? (
          <ChartBox className="h-52 min-w-0 sm:h-64">
            {({ width, height }) => (
              <BarChart width={width} height={height} data={monthly} margin={{ left: 0, right: 4, top: 16, bottom: 4 }}>
                <XAxis dataKey="month" stroke="#9a9a9a" fontSize={11} interval={0} />
                <YAxis stroke="#9a9a9a" fontSize={11} width={42} domain={pnlDomain} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={1000} animationEasing="ease-out">
                  {monthly.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? "#2dd4bf" : "#fb7185"} />)}
                  <LabelList
                    dataKey="pnl"
                    position="top"
                    offset={8}
                    fill="#f5f5f5"
                    fontSize={12}
                    fontWeight={700}
                    formatter={(v) => money(Number(v))}
                  />
                </Bar>
              </BarChart>
            )}
          </ChartBox>
        ) : (
          <div className="h-52 min-w-0 sm:h-64"><Empty /></div>
        )}
      </div>

    </div>
  );
}

function StrategySummary({
  title,
  totals,
}: {
  title: string;
  totals: {
    invested: number;
    net: number;
    wins: number;
    closed: number;
    winRate: number;
    openInvested: number;
    openCount: number;
  };
}) {
  const netPct = totals.invested ? totals.net / totals.invested : 0;
  return (
    <section className="p-3 sm:p-4">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-3">
        <Stat label="Total Net P/L" value={<Count value={totals.net} format={money} />} tone={totals.net >= 0 ? "good" : "bad"} sub={pct(netPct)} />
        <Stat label="Capital invested" value={<Count value={totals.invested} format={money} />} sub={`${totals.openCount + totals.closed} positions`} />
        <Stat label="Win rate" value={<Count value={totals.winRate} format={pct} />} sub={`${totals.wins}/${totals.closed} closed`} />
      </div>
    </section>
  );
}

function ChartBox({
  children,
  className = "h-52 min-w-0 sm:h-64",
}: {
  children: (size: { width: number; height: number }) => ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => {
      const next = { width: node.clientWidth, height: node.clientHeight };
      if (next.width > 0 && next.height > 0) setSize(next);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {size.width > 0 && size.height > 0 ? children(size) : <Empty />}
    </div>
  );
}

function Empty() {
  return <div className="flex h-full items-center justify-center text-sm text-muted">No data yet</div>;
}
