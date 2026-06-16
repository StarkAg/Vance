"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { createHash, createHmac } from "node:crypto";

// Live Groww portfolio access. Generates a fresh daily access token from the
// long-lived TOTP credentials (so it survives Groww's 6 AM reset with no manual
// step), then reads holdings. Reads are not IP-whitelist gated, so this works
// from Convex's servers. Set the secrets once:
//   npx convex env set GROWW_TOTP_TOKEN  <long token>
//   npx convex env set GROWW_TOTP_SECRET <base32 seed>
// (Approval-flow fallback: GROWW_API_KEY + GROWW_API_SECRET.)

const BASE = "https://api.groww.in/v1";
const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
  "X-API-VERSION": "1.0",
});

// RFC 6238 TOTP (SHA-1, 6 digits, 30s) from a base32 seed.
function totpFromSecret(base32: string, step = 30, digits = 6): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = "";
  for (const c of clean) {
    const idx = alphabet.indexOf(c);
    if (idx === -1) throw new Error(`Invalid base32 char in TOTP secret: ${c}`);
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Math.floor(Date.now() / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", bytes).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

async function getAccessToken(): Promise<string> {
  const totpToken = process.env.GROWW_TOTP_TOKEN;
  const totpSecret = process.env.GROWW_TOTP_SECRET;
  const apiKey = process.env.GROWW_API_KEY;
  const apiSecret = process.env.GROWW_API_SECRET;

  let bearer: string;
  let body: Record<string, string>;
  if (totpToken && totpSecret) {
    bearer = totpToken;
    body = { key_type: "totp", totp: totpFromSecret(totpSecret) };
  } else if (apiKey && apiSecret) {
    bearer = apiKey;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const checksum = createHash("sha256").update(apiSecret + timestamp).digest("hex");
    body = { key_type: "approval", checksum, timestamp };
  } else {
    throw new Error(
      "Groww credentials not set. Run: npx convex env set GROWW_TOTP_TOKEN <token> && npx convex env set GROWW_TOTP_SECRET <seed>",
    );
  }

  const res = await fetch(`${BASE}/token/api/access`, {
    method: "POST",
    headers: { ...headers(bearer), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | { token?: string; status?: string; error?: { message?: string } }
    | null;
  const token = data?.token;
  if (!res.ok || !token) {
    throw new Error(`Groww token generation failed (HTTP ${res.status}): ${data?.error?.message ?? "unknown"}`);
  }
  return token;
}

export type GrowwHolding = {
  id: string;
  symbol: string;
  qty: number;
  price: number;
  exchange: "NSE" | "BSE";
};

// Current DEMAT holdings — the closest the API offers to "past buys" (the API
// has NO historical order endpoint; the order book is current-day only).
export const holdings = action({
  args: {},
  handler: async (): Promise<GrowwHolding[]> => {
    const token = await getAccessToken();
    const res = await fetch(`${BASE}/holdings/user`, { headers: headers(token) });
    const data = (await res.json().catch(() => null)) as
      | { payload?: { holdings?: Array<Record<string, unknown>> }; error?: { message?: string } }
      | null;
    if (!res.ok) {
      throw new Error(`Groww holdings failed (HTTP ${res.status}): ${data?.error?.message ?? "unknown"}`);
    }
    return (data?.payload?.holdings ?? [])
      .map((h): GrowwHolding => {
        const exchanges = (h.tradable_exchanges as string[] | undefined) ?? [];
        return {
          id: String(h.isin ?? h.trading_symbol ?? ""),
          symbol: String(h.trading_symbol ?? ""),
          qty: Number(h.quantity ?? 0),
          price: Number(h.average_price ?? 0),
          exchange: exchanges.includes("NSE") || exchanges.length === 0 ? "NSE" : "BSE",
        };
      })
      .filter((h) => h.symbol && h.qty > 0)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  },
});

// Fetch the current trading day's order book and persist it to the growwOrders
// table (upsert by id). The Groww order-list endpoint is day-scoped, so running
// this regularly — on UI open and via the daily cron (convex/crons.ts) —
// accumulates a full order history that the API itself doesn't keep.
export const syncOrders = action({
  args: {},
  handler: async (ctx): Promise<{ inserted: number; updated: number; synced: number }> => {
    const token = await getAccessToken();
    const res = await fetch(`${BASE}/order/list?segment=CASH&page=0&page_size=100`, {
      headers: headers(token),
    });
    const data = (await res.json().catch(() => null)) as
      | { payload?: { order_list?: Array<Record<string, unknown>> }; error?: { message?: string } }
      | null;
    if (!res.ok) {
      throw new Error(`Groww order list failed (HTTP ${res.status}): ${data?.error?.message ?? "unknown"}`);
    }
    const now = Date.now();
    const orders = (data?.payload?.order_list ?? [])
      .map((o) => {
        const filled = Number(o.filled_quantity ?? 0);
        const when = String(o.trade_date ?? o.exchange_time ?? o.created_at ?? "");
        return {
          growwOrderId: String(o.groww_order_id ?? ""),
          symbol: String(o.trading_symbol ?? ""),
          side: o.transaction_type === "SELL" ? "SELL" : "BUY",
          status: String(o.order_status ?? ""),
          qty: filled > 0 ? filled : Number(o.quantity ?? 0),
          price: Number(o.average_fill_price ?? o.price ?? 0),
          exchange: o.exchange === "BSE" ? "BSE" : "NSE",
          segment: String(o.segment ?? "CASH"),
          date: when ? when.slice(0, 10) : "",
          syncedAt: now,
        };
      })
      .filter((o) => o.growwOrderId && o.symbol);

    const result = await ctx.runMutation(internal.growwStore.upsertOrders, { orders });
    return { ...result, synced: orders.length };
  },
});
