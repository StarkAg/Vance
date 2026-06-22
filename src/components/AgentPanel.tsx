import { useMemo, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Icon } from "./icons";

// Read-only view of the agent's latest position review (convex/agent.ts).
// Propose-only: it shows hold/trim/exit calls; the human acts on them.
type Verdict = {
  symbol: string;
  action: "HOLD" | "TRIM" | "EXIT";
  confidence: "low" | "medium" | "high";
  reason: string;
};
type Review = {
  summary: string;
  verdicts: Verdict[];
  model: string;
  marketOpen: boolean;
  basedOnSnapshotAt: number | null;
};

const actionStyle: Record<Verdict["action"], string> = {
  EXIT: "bg-bad/15 text-bad",
  TRIM: "bg-amber-500/15 text-amber-400",
  HOLD: "bg-good/15 text-good",
};

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export default function AgentPanel() {
  const snap = useQuery(api.growwStore.agentReview);
  const runReview = useAction(api.agent.reviewPositions);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const data = useMemo<Review | null>(() => {
    if (!snap?.payload) return null;
    try { return JSON.parse(snap.payload) as Review; } catch { return null; }
  }, [snap]);

  async function onRun() {
    setRunning(true);
    setErr(null);
    try {
      await runReview({});
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Review failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name="bot" className="h-5 w-5 text-brand" />
          <h2 className="text-xl font-bold text-slate-100">Agent</h2>
        </div>
        <div className="flex items-center gap-3">
          {snap && <span className="text-xs text-muted">reviewed {ago(snap.updatedAt)}</span>}
          <button
            onClick={onRun}
            disabled={running}
            className="rounded-lg bg-brand/15 px-3 py-1.5 text-sm font-semibold text-brand transition-colors hover:bg-brand/25 disabled:opacity-50"
          >
            {running ? "Reviewing…" : "Review now"}
          </button>
        </div>
      </div>

      {/* Goal banner */}
      <div className="card flex items-center gap-3 p-3 text-sm">
        <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-bold text-brand">GOAL</span>
        <span className="text-slate-300">Protect capital · book profit. The agent reviews every open contract and proposes a call — it never places orders.</span>
      </div>

      {err && (
        <div className="card border-bad/40 p-3 text-sm text-bad">{err}</div>
      )}

      {snap === undefined ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : !data ? (
        <div className="card p-5 text-sm text-muted">
          No review yet. Hit <span className="text-brand">Review now</span> — or it runs automatically every 5 min during market hours.
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="card p-4">
            <div className="mb-1 text-xs text-muted">Agent read</div>
            <p className="text-sm leading-relaxed text-slate-200">{data.summary}</p>
          </div>

          {/* Per-contract verdicts */}
          {data.verdicts.length === 0 ? (
            <div className="card p-5 text-sm text-muted">No open positions to manage right now.</div>
          ) : (
            <div className="space-y-2">
              {data.verdicts.map((v) => (
                <div key={v.symbol} className="card flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-100">{v.symbol}</div>
                    <p className="mt-0.5 text-sm text-slate-300">{v.reason}</p>
                    <div className="mt-1 text-[11px] text-muted">confidence: {v.confidence}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${actionStyle[v.action]}`}>
                    {v.action}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p className="px-1 text-xs text-muted">
        Powered by Claude ({data?.model ?? "claude-opus-4-8"}). Read-only — verdicts are proposals; you place any orders yourself from the VM.
      </p>
    </div>
  );
}
