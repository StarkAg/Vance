#!/usr/bin/env node
// SAFE order-API smoke test: places a BUY LIMIT far below market (cannot fill),
// reads it back, then cancels it. Proves create -> status -> cancel work
// without any real transaction. Reads GROWW_ACCESS_TOKEN from .env.local.

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
    method: body ? 'POST' : 'GET',
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

const refId = 'clitest' + String(Date.now()).slice(-8); // 8-20 alphanumeric

const order = {
  trading_symbol: 'GICRE',
  quantity: 1,
  price: 50,              // ~₹50 vs ~₹358 market -> cannot fill on a BUY
  validity: 'DAY',
  exchange: 'NSE',
  segment: 'CASH',
  product: 'CNC',
  order_type: 'LIMIT',
  transaction_type: 'BUY',
  order_reference_id: refId,
};

console.log('1) PLACE  ', JSON.stringify(order));
const placed = await api('/order/create', order);
console.log(`   -> HTTP ${placed.status}`, JSON.stringify(placed.json));

const orderId = placed.json?.payload?.groww_order_id;
const orderStatus = placed.json?.payload?.order_status;
if (!orderId) {
  console.log('\nNo groww_order_id returned (order may have been rejected). Nothing to cancel.');
  process.exit(0);
}

console.log(`\n2) STATUS  groww_order_id=${orderId}`);
const st = await api(`/order/status/${orderId}?segment=CASH`);
console.log(`   -> HTTP ${st.status}`, JSON.stringify(st.json));

if (['REJECTED', 'CANCELLED', 'EXECUTED'].includes(orderStatus)) {
  console.log(`\nOrder already terminal (${orderStatus}); no cancel needed.`);
  process.exit(0);
}

console.log(`\n3) CANCEL  groww_order_id=${orderId}`);
const cx = await api('/order/cancel', { segment: 'CASH', groww_order_id: orderId });
console.log(`   -> HTTP ${cx.status}`, JSON.stringify(cx.json));
