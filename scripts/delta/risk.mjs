// Hard risk limits for the Delta agent. Every one of these is a veto:
// the runner asks permission before each order and aborts on the first refusal.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { env } from './client.mjs';

const STATE = new URL('./.session-state.json', import.meta.url);
const KILL  = new URL('./KILL', import.meta.url);

export const LIMITS = {
  leverage:          Number(env.DELTA_LEVERAGE ?? 200),
  maxNotionalUsd:    Number(env.DELTA_MAX_NOTIONAL ?? 2000),
  maxMarginUsd:      Number(env.DELTA_MAX_MARGIN ?? 20),
  maxDailyLossUsd:   Number(env.DELTA_MAX_DAILY_LOSS ?? 25),
  maxConsecLosses:   Number(env.DELTA_MAX_CONSEC_LOSSES ?? 3),
  maxTradesPerDay:   Number(env.DELTA_MAX_TRADES ?? 10),
  // At 200x, liquidation is ~0.5% away. If price drifts more than this between
  // the snapshot Claude judged and the moment we send, the decision is stale.
  maxSlipBps:        Number(env.DELTA_MAX_SLIP_BPS ?? 5),
  maxDecisionAgeMs:  Number(env.DELTA_MAX_DECISION_AGE_MS ?? 3000),
};

// maxMarginUsd and maxNotionalUsd can contradict each other: at 200x a $2000
// notional cap means you can never post more than $10, so a $20 margin cap is
// unreachable. This is the margin that is actually at risk at full size, and
// the only honest denominator for "fee as a % of margin".
export const effectiveMarginUsd = Math.min(
  LIMITS.maxMarginUsd,
  LIMITS.maxNotionalUsd / LIMITS.leverage,
);

const blank = { day: new Date().toISOString().slice(0, 10), realisedUsd: 0, consecLosses: 0, trades: 0 };

export function loadState() {
  if (!existsSync(STATE)) return { ...blank };
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  return s.day === blank.day ? s : { ...blank };   // reset at UTC midnight
}

export const saveState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));

export function recordFill(state, realisedUsd) {
  state.trades += 1;
  state.realisedUsd += realisedUsd;
  state.consecLosses = realisedUsd < 0 ? state.consecLosses + 1 : 0;
  saveState(state);
  return state;
}

// Returns [] when clear to trade, else the list of reasons to stand down.
export function check({ state, notionalUsd, marginUsd, decidedAt, decidedPrice, livePrice }) {
  const stop = [];

  if (existsSync(KILL)) stop.push('KILL file present — manual kill switch engaged');

  if (state.realisedUsd <= -LIMITS.maxDailyLossUsd)
    stop.push(`daily loss ${state.realisedUsd.toFixed(2)} hit limit -${LIMITS.maxDailyLossUsd}`);
  if (state.consecLosses >= LIMITS.maxConsecLosses)
    stop.push(`${state.consecLosses} consecutive losses (max ${LIMITS.maxConsecLosses})`);
  if (state.trades >= LIMITS.maxTradesPerDay)
    stop.push(`${state.trades} trades today (max ${LIMITS.maxTradesPerDay})`);

  if (notionalUsd > LIMITS.maxNotionalUsd)
    stop.push(`notional $${notionalUsd.toFixed(0)} over cap $${LIMITS.maxNotionalUsd}`);
  if (marginUsd > LIMITS.maxMarginUsd)
    stop.push(`margin $${marginUsd.toFixed(2)} over cap $${LIMITS.maxMarginUsd}`);

  // Staleness: the BEL CE lesson, on a much faster clock.
  const ageMs = Date.now() - decidedAt;
  if (ageMs > LIMITS.maxDecisionAgeMs)
    stop.push(`decision ${ageMs}ms old (max ${LIMITS.maxDecisionAgeMs}ms)`);

  const slipBps = Math.abs(livePrice - decidedPrice) / decidedPrice * 10_000;
  if (slipBps > LIMITS.maxSlipBps)
    stop.push(`price moved ${slipBps.toFixed(1)}bps since decision (max ${LIMITS.maxSlipBps}bps)`);

  return stop;
}
