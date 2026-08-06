import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const recordUsage = internalMutation({
  args: {
    at: v.number(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    kind: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("ocrUsage", args);
  },
});
