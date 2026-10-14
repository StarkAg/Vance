// Delta Exchange India — HMAC-signed REST client.
// Reads DELTA_API_KEY / DELTA_API_SECRET from .env.local.
// DELTA_ENV=testnet|live picks the base URL (defaults to testnet on purpose).

import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

// .env.local is the baseline; the real process environment overrides it, so
// `DELTA_ENV=live npm run delta:arm` means what it says. Previously this file
// read .env.local ONLY while risk.mjs read process.env ONLY, which meant shell
// vars silently moved the risk limits but could not move the environment.
function readEnvFile() {
  try {
    return Object.fromEntries(
      readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
        .split('\n').map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
        .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
    );
  } catch {
    return {};   // no .env.local yet: public endpoints still work
  }
}

const fileEnv = readEnvFile();
export const env = new Proxy({}, {
  get: (_, k) => process.env[k] ?? fileEnv[k],
  has: (_, k) => k in process.env || k in fileEnv,
});

const LIVE = 'https://api.india.delta.exchange';
const TEST = 'https://cdn-ind.testnet.deltaex.org';

export const IS_LIVE = (env.DELTA_ENV ?? 'testnet') === 'live';
export const BASE = IS_LIVE ? LIVE : TEST;

const KEY = env.DELTA_API_KEY;
const SECRET = env.DELTA_API_SECRET;

// Public endpoints need no key, so a dry run works before any key exists.
export const HAS_KEYS = Boolean(KEY && SECRET);

// Delta signs: method + timestamp + path + queryString + body.
// The signature is valid for 5s, so the system clock must be accurate.
function sign(method, path, query, body) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const payload = method + ts + path + query + body;
  return { ts, sig: createHmac('sha256', SECRET).update(payload).digest('hex') };
}

export async function call(method, path, { params, body, auth = true } = {}) {
  const query = params && Object.keys(params).length
    ? '?' + new URLSearchParams(params).toString() : '';
  const payload = body ? JSON.stringify(body) : '';

  // Delta rejects requests without a User-Agent.
  const headers = { 'User-Agent': 'vance-quant/1.0', Accept: 'application/json' };
  if (payload) headers['Content-Type'] = 'application/json';

  if (auth) {
    if (!KEY || !SECRET) throw new Error('DELTA_API_KEY / DELTA_API_SECRET missing from .env.local');
    const { ts, sig } = sign(method, path, query, payload);
    Object.assign(headers, { 'api-key': KEY, timestamp: ts, signature: sig });
  }

  const res = await fetch(BASE + path + query, {
    method, headers, body: payload || undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code = json?.error?.code ?? json?.error ?? res.statusText;
    throw new Error(`Delta ${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(code)}`);
  }
  return json?.result ?? json;
}

export const getProduct   = (symbol) => call('GET', `/v2/products/${symbol}`, { auth: false });
export const getTicker    = (symbol) => call('GET', `/v2/tickers/${symbol}`, { auth: false });
export const getBalances  = () => call('GET', '/v2/wallet/balances');
export const getPositions = () => call('GET', '/v2/positions/margined');
export const setLeverage  = (productId, leverage) =>
  call('POST', `/v2/products/${productId}/orders/leverage`, { body: { leverage: String(leverage) } });
export const placeOrder   = (order) => call('POST', '/v2/orders', { body: order });
export const cancelAll    = (productId) =>
  call('DELETE', '/v2/orders/all', { body: { product_id: productId } });

// OHLCV candles. resolution: 1m 5m 15m 1h 1d ...
export async function getCandles(symbol, resolution, count) {
  const end = Math.floor(Date.now() / 1000);
  const secs = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1d': 86400 }[resolution] ?? 60;
  return call('GET', '/v2/history/candles', {
    auth: false,
    params: { resolution, symbol, start: end - secs * count, end },
  });
}
