import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// All monetary inputs are stored raw; computed fields (P/L, allocations, running
// balances) are derived on the client in src/lib/calc.ts — exactly mirroring the
// original spreadsheet formulas.
export default defineSchema({
  // Monthly Budget — only the inputs are stored; buckets are auto-allocated.
  budget: defineTable({
    date: v.string(), // ISO yyyy-mm-dd
    cash: v.number(),
    online: v.number(),
    gym: v.number(),
    skill: v.number(),
    extra: v.number(), // extra cash flow into stability
    note: v.optional(v.string()),
  }).index("by_date", ["date"]),

  // Swing Trading journal (short-term trades).
  swing: defineTable({
    buyDate: v.string(),
    sellDate: v.optional(v.string()),
    name: v.optional(v.string()),
    qty: v.number(),
    buyPrice: v.number(),
    sellPrice: v.optional(v.number()),
    currentPrice: v.optional(v.number()),
    charges: v.number(),
    budget: v.optional(v.number()),
    other: v.optional(v.number()),
    feedback: v.optional(v.string()),
  }).index("by_buyDate", ["buyDate"]),

  // Yearly Stock journal (long-term holdings).
  yearly: defineTable({
    buyDate: v.string(),
    sellDate: v.optional(v.string()),
    name: v.optional(v.string()),
    qty: v.number(),
    buyPrice: v.number(),
    sellPrice: v.optional(v.number()),
    currentPrice: v.optional(v.number()),
    charges: v.number(),
    budget: v.optional(v.number()),
    other: v.optional(v.number()),
  }).index("by_buyDate", ["buyDate"]),

  // Snapshot of Groww orders. The Groww API only returns the current trading
  // day's order book, so we persist each sync here to build up full history.
  growwOrders: defineTable({
    growwOrderId: v.string(),
    symbol: v.string(),
    side: v.string(), // BUY | SELL
    status: v.string(),
    qty: v.number(),
    price: v.number(),
    exchange: v.string(), // NSE | BSE
    segment: v.string(),
    date: v.string(), // ISO yyyy-mm-dd
    syncedAt: v.number(),
  })
    .index("by_orderId", ["growwOrderId"])
    .index("by_date", ["date"]),

  // Sector-rotation snapshot from Moneycontrol's sector API. A local cron
  // (scripts/sector-cron.sh, residential IP) pushes one row every 15 min during
  // market hours; the dashboard reads the latest. Payload is JSON-stringified —
  // it's a denormalized display blob, never queried by field. See
  // scripts/sector-uptrend.mjs --push.
  sectorRotation: defineTable({
    updatedAt: v.number(), // epoch ms when fetched
    payload: v.string(), // JSON: { ranked, broad, picks, fetchedAtIST }
  }),

  // Ledger — six independent double-entry accounts, distinguished by `account`.
  ledger: defineTable({
    account: v.string(), // Gym | Needs | Wants | Fixed Deposit | Saving | Stock
    date: v.string(),
    particular: v.string(),
    debit: v.number(),
    credit: v.number(),
    order: v.number(), // manual sort within an account
  }).index("by_account", ["account", "order"]),
});
