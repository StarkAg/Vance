import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useAccount, ACCOUNT_LABELS } from "../lib/account";

// Mirrors the payload built by convex/groww.ts → pollPosition.
type Position = {
  symbol: string;
  underlying: string;
  strike: number;
  isCall: boolean;
  entry: number;
  qty: number;
  ltp: number;
  uLtp: number;
  intrinsic: number;
  timeValue: number;
  pnl: number;
  pnlPct: number;
  dayChange: number;
  oiChange: number;
  oco: { target: number | null; stop: number | null } | null;
  suggestedStop: number | null;
  daysToExpiry: number | null;
  expiry: string;
  urgency: "ok" | "warn" | "danger";
  recs: string[];
};
type Payload = { positions: Position[]; marketOpen: boolean; fetchedAtIST: string };

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${inr(n)}`;
const pnlClass = (n: number) => (n > 0 ? "text-good" : n < 0 ? "text-bad" : "text-slate-300");
const urgencyClass: Record<Position["urgency"], string> = {
  ok: "bg-good/15 text-good",
  warn: "bg-amber-500/15 text-amber-400",
  danger: "bg-bad/15 text-bad",
};

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// NSE F&O open? Mon–Fri 09:15–15:30 IST. Gates the live refresh loop.
function marketOpenIST(): boolean {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 555 && mins <= 930;
}

export default function LivePanel() {
  const { account } = useAccount();
  const fetchPositions = useAction(api.groww.livePositions);
  const [data, setData] = useState<Payload | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Fetch the selected account's positions on mount/account-change, then every
  // 5 s while visible + market open. Positions come from the account; the live
  // LTPs inside are always quoted via Harsh's paid API (server-side).
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setData(null); setLoading(true); setErr(null);
    const once = async () => {
      try {
        const r = (await fetchPositions({ account })) as Payload;
        if (!stopped) { setData(r); setUpdatedAt(Date.now()); setErr(null); }
      } catch (e) {
        if (!stopped) setErr(e instanceof Error ? e.message : "Couldn't load positions");
      } finally {
        if (!stopped) setLoading(false);
      }
    };
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible" && marketOpenIST()) await once();
      timer = setTimeout(tick, 5000);
    };
    void once();
    timer = setTimeout(tick, 5000);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [account, fetchPositions]);

  if (loading && !data) return <Shell account={account}><div className="text-sm text-muted">Loading…</div></Shell>;
  if (err && !data) return <Shell account={account}><div className="card border-bad/40 p-3 text-sm text-bad">{err}</div></Shell>;

  return (
    <Shell
      account={account}
      meta={
        <span className="text-muted">
          <span className={`mr-2 inline-block h-2 w-2 rounded-full ${data?.marketOpen ? "bg-good" : "bg-muted"}`} />
          {data?.marketOpen ? "Market open" : "Market closed"} · {data?.fetchedAtIST}{updatedAt ? ` · ${ago(updatedAt)}` : ""}
        </span>
      }
    >
      {!data || data.positions.length === 0 ? (
        <div className="card p-5 text-sm text-muted">No open F&amp;O positions in {ACCOUNT_LABELS[account]}&apos;s account right now.</div>
      ) : (
        data.positions.map((p) => <Card key={p.symbol} p={p} />)
      )}
      <p className="px-1 text-xs text-muted">
        Read-only monitor for {ACCOUNT_LABELS[account]}&apos;s account — live rates via Harsh&apos;s API. Never places orders; placement stays on the whitelisted VM.
      </p>
    </Shell>
  );
}

function Card({ p }: { p: Position }) {
  return (
    <div className="card min-w-0 space-y-4 p-4">
      {/* headline P&L */}
      <div>
        <div className="text-xs text-muted">{p.symbol}</div>
        <div className={`text-3xl font-extrabold tabular-nums ${pnlClass(p.pnl)}`}>{signed(p.pnl)}</div>
        <div className="text-xs text-muted">
          {p.pnlPct >= 0 ? "+" : ""}{p.pnlPct}% · LTP {inr(p.ltp)} · entry {inr(p.entry)} · {p.qty} qty
        </div>
      </div>

      {/* live internals */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <Row k={`${p.underlying} spot`} v={inr(p.uLtp)} />
        <Row k="Strike" v={`${inr(p.strike)} ${p.isCall ? "CE" : "PE"}`} />
        <Row k="Intrinsic" v={inr(p.intrinsic)} />
        <Row k="Time value" v={inr(p.timeValue)} />
        <Row k="Option day" v={`${p.dayChange >= 0 ? "+" : ""}${p.dayChange}%`} vClass={pnlClass(p.dayChange)} />
        <Row k="OI day" v={`${p.oiChange >= 0 ? "+" : ""}${p.oiChange}%`} vClass={pnlClass(p.oiChange)} />
      </div>

      {/* protection */}
      <div className="rounded-lg border border-line/60 p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs text-muted">OCO protection</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${p.oco ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
            {p.oco ? "ACTIVE" : "NONE"}
          </span>
        </div>
        {p.oco && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row k="Target → sell" v={p.oco.target != null ? inr(p.oco.target) : "—"} vClass="text-good" />
            <Row k="Stop → sell" v={p.oco.stop != null ? inr(p.oco.stop) : "—"} vClass="text-bad" />
          </div>
        )}
        {p.suggestedStop != null && (
          <div className="mt-1 text-sm">
            <Row k="Suggested trail stop" v={inr(p.suggestedStop)} vClass="text-brand" />
          </div>
        )}
      </div>

      {/* expiry + action */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm">
          <span className="text-muted">Expiry {p.expiry || "—"}</span>
          {p.daysToExpiry != null && (
            <span className={`ml-2 font-bold ${p.daysToExpiry <= 2 ? "text-bad" : "text-brand"}`}>{p.daysToExpiry}d</span>
          )}
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${urgencyClass[p.urgency]}`}>{p.urgency.toUpperCase()}</span>
      </div>
      <div className="space-y-1.5">
        {p.recs.map((r, i) => (
          <div key={i} className="rounded-lg border border-line/60 bg-panel2/40 px-3 py-2 text-sm text-slate-200">{r}</div>
        ))}
      </div>
    </div>
  );
}

function Row({ k, v, vClass = "text-slate-200" }: { k: string; v: string; vClass?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted">{k}</span>
      <span className={`font-semibold tabular-nums ${vClass}`}>{v}</span>
    </div>
  );
}

function Shell({ children, meta, account }: { children: React.ReactNode; meta?: React.ReactNode; account: "primary" | "aditya" }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-slate-100">Live Position · {ACCOUNT_LABELS[account]}</h2>
        {meta && <span className="text-xs">{meta}</span>}
      </div>
      {children}
    </div>
  );
}
