import { mutation, query } from "./_generated/server";
import { action } from "./_generated/server";
import { v } from "convex/values";

type TrendNews = { sector: string; title: string; url: string; source: string; publishedAt: string };

const decodeXml = (value: string) => value
  .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

const itemField = (item: string, field: string) => {
  const match = item.match(new RegExp(`<${field}(?:\\s[^>]*)?>([\\s\\S]*?)</${field}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
};

// Latest "Aditya's Sector" snapshot (Moneycontrol 1d/5d top-10 method). Returns
// null until the tab's Refresh button has pushed at least once. Parsing of
// `payload` happens client-side.
export const get = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("adityaSector").collect();
    if (!rows.length) return null;
    const latest = rows.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    return { updatedAt: latest.updatedAt, payload: latest.payload };
  },
});

// Replace the snapshot (single-row table). Called by the runAdityaScan action.
export const push = mutation({
  args: { updatedAt: v.number(), payload: v.string() },
  handler: async (ctx, { updatedAt, payload }) => {
    const existing = await ctx.db.query("adityaSector").collect();
    for (const row of existing) await ctx.db.delete(row._id);
    await ctx.db.insert("adityaSector", { updatedAt, payload });
  },
});

// Latest relevant news headline for highlighted sectors. The client only asks
// for confirmed (in-both) sectors and caps the batch to keep this lightweight.
export const trendNews = action({
  args: { sectors: v.array(v.string()) },
  handler: async (_ctx, { sectors }): Promise<TrendNews[]> => {
    const unique = [...new Set(sectors.map((s) => s.trim()).filter(Boolean))].slice(0, 6);
    const results = await Promise.all(unique.map(async (sector): Promise<TrendNews | null> => {
      const query = encodeURIComponent(`${sector} sector India stock market`);
      const url = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const xml = await res.text();
        const item = xml.match(/<item>([\s\S]*?)<\/item>/i)?.[1];
        if (!item) return null;
        const title = itemField(item, "title");
        const link = itemField(item, "link");
        if (!title || !link) return null;
        return {
          sector,
          title,
          url: link,
          source: itemField(item, "source"),
          publishedAt: itemField(item, "pubDate"),
        };
      } catch {
        return null;
      }
    }));
    return results.filter((item): item is TrendNews => item !== null);
  },
});
