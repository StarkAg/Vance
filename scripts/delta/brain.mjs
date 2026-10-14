// Per-bar decision. Claude reads a market snapshot and returns a structured call.
// Latency is a hard constraint: risk.js rejects any decision older than
// DELTA_MAX_DECISION_AGE_MS, so keep effort low and the payload small.

import Anthropic from '@anthropic-ai/sdk';
import { env } from './client.mjs';

// Two ways to reach Claude, first-party by default:
//   ANTHROPIC_API_KEY                      -> api.anthropic.com
//   ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY -> a gateway (e.g. MESHAPI_URL/MESHAPI_KEY)
// A gateway sees every snapshot this bot sends, including live position and
// entry price, and may not implement output_config (see decide() below).
const BASE_URL = env.ANTHROPIC_BASE_URL ?? null;
const API_KEY = env.ANTHROPIC_API_KEY;
if (!API_KEY) throw new Error('ANTHROPIC_API_KEY missing from .env.local and the environment');

const client = new Anthropic({ apiKey: API_KEY, ...(BASE_URL ? { baseURL: BASE_URL } : {}) });

// Opus 5 by default. If the staleness guard keeps rejecting decisions as too
// old, that is a latency problem, not a config problem — drop DELTA_EFFORT to
// 'low' first, and only then consider DELTA_MODEL=claude-haiku-4-5.
const MODEL  = process.env.DELTA_MODEL ?? 'claude-opus-5';
const EFFORT = process.env.DELTA_EFFORT ?? 'low';

const SYSTEM = `You are the decision layer of a leveraged BTC perpetual futures bot on Delta Exchange India.

You are given a snapshot of recent candles, the live ticker, funding, and the current position.
Return exactly one action.

Economics you must respect, because they dominate the outcome at high leverage:
- Round-trip cost is 0.10% of NOTIONAL (taker both sides) plus 18% GST.
- At the configured leverage that cost is a large fraction of posted margin.
- Liquidation sits roughly 0.5% away from entry at 200x.
- Therefore: a marginal or low-conviction signal is strictly worse than flat,
  because flat costs nothing and any round trip costs real money.

Choose "flat" unless the setup is clear. Most bars are flat. Do not manufacture
conviction to look useful — churn is the dominant way this strategy loses money.
Return "hold" if the existing position's thesis is intact and you would not re-enter it today.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'confidence', 'reason'],
  properties: {
    action:     { type: 'string', enum: ['long', 'short', 'flat', 'hold'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason:     { type: 'string', maxLength: 280 },
  },
};

export async function decide({ symbol, candles, ticker, position, leverage }) {
  // Compact the candles — fewer input tokens is directly less latency.
  // Delta returns candles NEWEST-FIRST, so slice(-40) took the OLDEST 40 of 60
  // and handed them over reversed: the model never saw the last 20 minutes.
  const bars = candles.slice(0, 40).reverse().map((c) =>
    `${new Date(c.time * 1000).toISOString().slice(11, 16)} o${c.open} h${c.high} l${c.low} c${c.close} v${c.volume}`,
  ).join('\n');

  const snapshot = [
    `symbol: ${symbol}   leverage: ${leverage}x`,
    `mark: ${ticker.mark_price}   spot: ${ticker.spot_price}`,
    // change_24h is absent on testnet; don't feed the model the string "undefined".
    `24h change: ${ticker.change_24h ?? 'n/a'}%   funding: ${ticker.funding_rate}`,
    `position: ${position ? `${position.size} @ ${position.entry_price}` : 'flat'}`,
    '',
    'last 40 bars (1m):',
    bars,
  ].join('\n');

  // `effort` is not supported on Haiku 4.5 / Sonnet 4.5 — sending it errors, so
  // the README's latency fallback (DELTA_MODEL=claude-haiku-4-5) would have
  // failed on every call. Only send it to models that accept it.
  const supportsEffort = !/^claude-(haiku-4-5|sonnet-4-5)/.test(MODEL);

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    output_config: {
      ...(supportsEffort ? { effort: EFFORT } : {}),
      format: { type: 'json_schema', schema: SCHEMA },
    },
    messages: [{ role: 'user', content: snapshot }],
  });

  if (res.stop_reason === 'refusal') throw new Error(`model refused: ${res.stop_details?.explanation}`);

  const text = res.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('no text block in model response');

  // A gateway that ignores output_config.format returns prose, not JSON. Fail
  // with the actual response rather than a bare "Unexpected token" from JSON.parse.
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `model did not return JSON${BASE_URL ? ` (via ${BASE_URL} — does it support output_config?)` : ''}: ` +
      text.slice(0, 200),
    );
  }
}
