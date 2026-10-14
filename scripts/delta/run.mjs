#!/usr/bin/env node
// Agent loop: snapshot -> Claude decides -> revalidate -> risk gate -> order.
//
//   node scripts/delta/run.mjs            # dry run, prints decisions, sends nothing
//   node scripts/delta/run.mjs --arm      # actually sends orders
//
// Live money additionally requires DELTA_ENV=live in .env.local. Two gates,
// because --arm on testnet and --arm on live must not be one keystroke apart.

import {
  getProduct, getTicker, getCandles, getPositions,
  setLeverage, placeOrder, IS_LIVE, HAS_KEYS,
} from './client.mjs';
import { decide } from './brain.mjs';
import { LIMITS, loadState, check, recordFill } from './risk.mjs';

const ARMED    = process.argv.includes('--arm');
const SYMBOL   = process.env.DELTA_SYMBOL ?? 'BTCUSD';
const INTERVAL = Number(process.env.DELTA_INTERVAL_MS ?? 60_000);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const product = await getProduct(SYMBOL);
const contractValue = Number(product.contract_value);   // BTC per contract
let state = loadState();

log(`${IS_LIVE ? 'LIVE' : 'testnet'} · ${SYMBOL} · ${LIMITS.leverage}x · ${ARMED ? 'ARMED' : 'dry run'}`);
if (!HAS_KEYS) log('no API key — public data only, positions assumed flat');
if (ARMED && !HAS_KEYS) { log('--arm needs DELTA_API_KEY/SECRET in .env.local'); process.exit(1); }
if (ARMED && IS_LIVE) log(`!! real money — max margin $${LIMITS.maxMarginUsd}, daily stop $${LIMITS.maxDailyLossUsd}`);
if (ARMED) await setLeverage(product.id, LIMITS.leverage);

const currentPosition = async () => {
  if (!HAS_KEYS) return null;   // unauthenticated dry run: assume flat
  const all = await getPositions();
  return all.find((p) => p.product_id === product.id && Number(p.size) !== 0) ?? null;
};

async function flatten(why) {
  const pos = await currentPosition();
  if (!pos) return;
  log(`flatten (${why}): ${pos.size} @ ${pos.entry_price}`);
  if (!ARMED) return;

  const signed = Number(pos.size);
  await placeOrder({
    product_id: product.id,
    size: Math.abs(signed),
    side: signed > 0 ? 'sell' : 'buy',
    order_type: 'market_order',
    reduce_only: true,
  });

  // Book the result. Without this, realisedUsd stayed 0 forever and the daily
  // loss stop and consecutive-loss halt could never fire — they were dead code.
  const exit = Number((await getTicker(SYMBOL)).mark_price);
  const entry = Number(pos.entry_price);
  const gross = signed * contractValue * (exit - entry);
  const fees = Math.abs(signed) * contractValue * (entry + exit) * 0.0005 * 1.18;
  const realised = gross - fees;
  state = recordFill(state, realised);
  log(`  realised $${realised.toFixed(2)} (gross $${gross.toFixed(2)} - fees $${fees.toFixed(2)})` +
      ` · day $${state.realisedUsd.toFixed(2)} · consec losses ${state.consecLosses} · trades ${state.trades}`);
}

// An orphaned leveraged position with nothing watching it is the worst
// outcome available, so every exit path closes out first.
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (stopping) process.exit(1);
    stopping = true;
    log(`${sig} — closing out before exit`);
    await flatten('shutdown').catch((e) => log('flatten FAILED:', e.message));
    process.exit(0);
  });
}
process.on('uncaughtException', async (e) => {
  log('uncaught:', e.message);
  await flatten('crash').catch(() => {});
  process.exit(1);
});

let lastTick = Date.now();

while (!stopping) {
  try {
    // Laptop sleep / suspend detector. Waking up with a stale view of a 200x
    // position and acting on it is exactly the BEL failure, faster.
    const gap = Date.now() - lastTick;
    if (gap > INTERVAL * 3) {
      log(`gap of ${Math.round(gap / 1000)}s — host slept. Flattening and halting.`);
      await flatten('wake from suspend');
      break;
    }
    lastTick = Date.now();

    const [candles, ticker, position] = await Promise.all([
      getCandles(SYMBOL, '1m', 60), getTicker(SYMBOL), currentPosition(),
    ]);

    const decidedAt = Date.now();
    const decidedPrice = Number(ticker.mark_price);
    const d = await decide({ symbol: SYMBOL, candles, ticker, position, leverage: LIMITS.leverage });
    log(`${d.action.padEnd(5)} conf ${d.confidence.toFixed(2)}  ${d.reason}`);

    if (d.action === 'hold') continue;
    if (d.action === 'flat') { if (position) await flatten('model says flat'); continue; }
    if (position) { log('  already positioned — hold'); continue; }

    // Size from the margin cap, then confirm notional also fits.
    const live = Number((await getTicker(SYMBOL)).mark_price);
    const notionalUsd = Math.min(LIMITS.maxMarginUsd * LIMITS.leverage, LIMITS.maxNotionalUsd);
    const size = Math.floor(notionalUsd / (live * contractValue));
    if (size < 1) { log('  size rounds to 0 contracts — skip'); continue; }

    const actualNotional = size * contractValue * live;
    const stop = check({
      state, decidedAt, decidedPrice, livePrice: live,
      notionalUsd: actualNotional,
      marginUsd: actualNotional / LIMITS.leverage,
    });
    if (stop.length) { log('  BLOCKED: ' + stop.join('; ')); if (stop.some((s) => /KILL|daily loss|consecutive/.test(s))) break; continue; }

    const order = {
      product_id: product.id, size,
      side: d.action === 'long' ? 'buy' : 'sell',
      order_type: 'market_order',
    };
    const feeUsd = actualNotional * 0.0005 * 2 * 1.18;
    log(`  ${ARMED ? 'SEND' : 'dry '} ${order.side} ${size} @ ~${live} · notional $${actualNotional.toFixed(0)} · round-trip fee $${feeUsd.toFixed(2)}`);

    if (ARMED) {
      const placed = await placeOrder(order);
      log(`  filled id=${placed.id} state=${placed.state}`);
      // The round trip is counted when it closes, in flatten(), where the
      // realised PnL is known. Counting it here too would double-count.
    }
  } catch (e) {
    log('error:', e.message);
  }
  await new Promise((r) => setTimeout(r, INTERVAL));
}

await flatten('loop exit');
log('stopped');
