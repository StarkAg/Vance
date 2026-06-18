import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Latest sector-rotation snapshot for the dashboard. Returns null until the
// local cron has pushed at least once. Parsing of `payload` happens client-side.
export const get = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("sectorRotation").collect();
    if (!rows.length) return null;
    const latest = rows.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    return { updatedAt: latest.updatedAt, payload: latest.payload };
  },
});

// Replace the snapshot (single-row table). Called by scripts/sector-uptrend.mjs
// --push from a residential IP, since Moneycontrol blocks datacenter IPs and a
// Convex cron could not fetch it.
export const push = mutation({
  args: { updatedAt: v.number(), payload: v.string() },
  handler: async (ctx, { updatedAt, payload }) => {
    const existing = await ctx.db.query("sectorRotation").collect();
    for (const row of existing) await ctx.db.delete(row._id);
    await ctx.db.insert("sectorRotation", { updatedAt, payload });
  },
});
