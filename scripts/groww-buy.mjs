#!/usr/bin/env node
// REAL ORDER — user-authorized: BUY 1 share NSE:IDEA, MARKET, CNC (delivery).
// Places the order and reads back its status. Does NOT cancel (intended to fill).
// Reads GROWW_ACCESS_TOKEN from .env.local.

import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);

const H = {
  Authorization: `Bearer ${env.GROWW_ACCESS_TOKEN}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'X-API-VERSION': '1.0',
};

const api = async (path, body) => {
  const res = await fetch(`https://api.groww.in/v1${path}`, {
    method: body ? 'POST' : 'GET', headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const order = {
  trading_symbol: 'IDEA',
  quantity: 1,
  validity: 'DAY',
  exchange: 'NSE',
  segment: 'CASH',
  product: 'CNC',
  order_type: 'MARKET',
  transaction_type: 'BUY',
  order_reference_id: 'buyidea' + String(Date.now()).slice(-8),
};

console.log('PLACE  ', JSON.stringify(order));
const placed = await api('/order/create', order);
console.log(`  -> HTTP ${placed.status}`, JSON.stringify(placed.json, null, 2));

const orderId = placed.json?.payload?.groww_order_id;
if (orderId) {
  const st = await api(`/order/status/${orderId}?segment=CASH`);
  console.log(`\nSTATUS  ${orderId} -> HTTP ${st.status}`, JSON.stringify(st.json, null, 2));
}
