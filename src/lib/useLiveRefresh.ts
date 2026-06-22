import { useEffect } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

// NSE cash/F&O open? Mon–Fri, 09:15–15:30 IST.
function marketOpenIST(): boolean {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 555 && mins <= 930;
}

// Drive near-real-time updates while a live tab is open. Re-runs the Groww poll
// (which rewrites the snapshot the UI subscribes to) every `intervalMs`, but
// ONLY when the tab is visible AND the market is open — so we never burn Groww's
// rate limit / daily quota on frozen weekend prices or a backgrounded tab.
// setTimeout-chained (not setInterval) so a slow poll never stacks calls.
//
// Groww Live Data quota: 300 req/min. Each poll makes ~8 Live Data calls.
// At 5 s interval: 12 client polls/min × 8 = 96 + 1 cron = ~104/min → safe headroom.
// At 2 s (old): 30 × 8 = 240 + cron, and with 2+ open positions hit the cap.
export function useLiveRefresh(intervalMs = 5000) {
  const poll = useAction(api.groww.pollPosition);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible" && marketOpenIST()) {
        try { await poll({}); } catch { /* transient — try again next tick */ }
      }
      timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [poll, intervalMs]);
}
