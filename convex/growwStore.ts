import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

// Persisted Groww order history. The sync action (convex/groww.ts) feeds this;
// the UI reads `savedOrders`. Lives in a non-"use node" file because Convex
// only allows actions in "use node" modules.

const orderObject = v.object({
  growwOrderId: v.string(),
  symbol: v.string(),
  side: v.string(),
  status: v.string(),
  qty: v.number(),
  price: v.number(),
  exchange: v.string(),
  segment: v.string(),
  date: v.string(),
  syncedAt: v.number(),
});

// All accumulated orders, newest first.
export const savedOrders = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("growwOrders").withIndex("by_date").collect();
    return rows.sort((a, b) => b.date.localeCompare(a.date) || b.syncedAt - a.syncedAt);
  },
});

// Upsert a batch by growwOrderId (so re-syncing the same day updates status/fills
// instead of duplicating). Internal — only the sync action calls it.
export const upsertOrders = internalMutation({
  args: { orders: v.array(orderObject) },
  handler: async (ctx, { orders }) => {
    let inserted = 0;
    let updated = 0;
    for (const o of orders) {
      const existing = await ctx.db
        .query("growwOrders")
        .withIndex("by_orderId", (q) => q.eq("growwOrderId", o.growwOrderId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, o);
        updated++;
      } else {
        await ctx.db.insert("growwOrders", o);
        inserted++;
      }
    }
    return { inserted, updated };
  },
});
