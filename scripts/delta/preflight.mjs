#!/usr/bin/env node
// Run this before every session. Catches the four things that silently break
// a Delta bot: wrong base URL, clock skew, wrong key scope, un-whitelisted IP.

import { call, getTicker, getBalances, getProduct, BASE, IS_LIVE, env } from './client.mjs';
import { LIMITS, effectiveMarginUsd } from './risk.mjs';

const SYMBOL = process.env.DELTA_SYMBOL ?? 'BTCUSD';
let fail = 0;
const ok   = (m) => console.log(`  ok    ${m}`);
const bad  = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const warn = (m) => console.log(`  warn  ${m}`);

console.log(`\nDelta preflight — ${IS_LIVE ? 'LIVE (real money)' : 'TESTNET (paper)'}\n${BASE}\n`);

// 1. Clock. Delta rejects signatures older than 5s; macOS drift kills this first.
const t0 = Date.now();
const res = await fetch(`${BASE}/v2/products/${SYMBOL}`, { headers: { 'User-Agent': 'vance-quant/1.0' } });
const serverDate = new Date(res.headers.get('date')).getTime();
const skew = Math.abs(serverDate - (t0 + Date.now()) / 2);
skew < 2000 ? ok(`clock skew ${Math.round(skew)}ms`)
            : bad(`clock skew ${Math.round(skew)}ms — signatures will be rejected (>5s window). Run: sudo sntp -sS time.apple.com`);

// 2. Public data.
try {
  const t = await getTicker(SYMBOL);
  ok(`market data — ${SYMBOL} mark ${t.mark_price}`);
} catch (e) { bad(`market data: ${e.message}`); }

// 3. Auth + key scope + IP whitelist. Delta returns a distinct error per cause.
try {
  const bals = await getBalances();
  const usd = bals.find((b) => b.asset_symbol === 'USD' || b.asset_id === 3);
  ok(`auth — balance ${usd?.available_balance ?? '0'} USD`);
} catch (e) {
  if (/ip_not_whitelisted|unauthorized_ip/i.test(e.message))
    bad(`IP not whitelisted. Add this machine's egress IP to the key. ${e.message}`);
  else if (/invalid_api_key|unauthorized/i.test(e.message))
    bad(`key rejected — wrong environment? testnet and live keys are NOT interchangeable. ${e.message}`);
  else bad(`auth: ${e.message}`);
}

// 4. Can this key actually trade? Probe without resting an order.
try {
  const p = await getProduct(SYMBOL);
  await call('DELETE', '/v2/orders/all', { body: { product_id: p.id } });
  ok('key has Trading permission');
} catch (e) {
  /read_only|insufficient|permission/i.test(e.message)
    ? bad(`key is Read Data only — cannot place orders. ${e.message}`)
    : warn(`trading probe inconclusive: ${e.message}`);
}

// 5. Restate the limits so they are never a surprise.
// Fee must be measured against the margin actually postable at full size, not
// against maxMarginUsd, which the notional cap can make unreachable. Dividing
// by the wrong one understated the true cost by 2x at the shipped defaults.
const rt = LIMITS.maxNotionalUsd * 0.001 * 1.18;
console.log(`\nlimits:  ${LIMITS.leverage}x  ·  max notional $${LIMITS.maxNotionalUsd}  ·  max margin $${LIMITS.maxMarginUsd}`);
if (effectiveMarginUsd < LIMITS.maxMarginUsd)
  console.log(`         note: at ${LIMITS.leverage}x the notional cap binds first — real margin at full size is $${effectiveMarginUsd.toFixed(2)}, not $${LIMITS.maxMarginUsd}`);
console.log(`         daily loss stop $${LIMITS.maxDailyLossUsd}  ·  ${LIMITS.maxTradesPerDay} trades/day  ·  ${LIMITS.maxConsecLosses} consec losses`);
console.log(`         staleness ${LIMITS.maxDecisionAgeMs}ms / ${LIMITS.maxSlipBps}bps`);
console.log(`\ncost:    round trip at max notional ≈ $${rt.toFixed(2)} (0.10% + 18% GST)`);
console.log(`         = ${(rt / effectiveMarginUsd * 100).toFixed(1)}% of the $${effectiveMarginUsd.toFixed(2)} actually at risk, per trade, before any price move`);
if (IS_LIVE) console.log(`         ${LIMITS.maxTradesPerDay} such trades compounds to ${((1 - (1 - rt / effectiveMarginUsd) ** LIMITS.maxTradesPerDay) * 100).toFixed(0)}% of margin`);

console.log(fail ? `\n${fail} check(s) failed — not safe to run.\n` : '\nAll checks passed.\n');
process.exit(fail ? 1 : 0);
