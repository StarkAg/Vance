"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

// Alerts are sent only from server-side actions. Set these on the Stocks
// Convex deployment; never expose either value to the browser.
const escapeHtml = (value: string) =>
  value.replace(/[<>&]/g, (ch) => (ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&amp;"));

export const sendTradeAlert = internalAction({
  args: { text: v.string() },
  handler: async (_ctx, { text }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return { sent: false, reason: "missing-env" as const };

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `<b>Vance trade watch</b>\n\n${escapeHtml(text)}`,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      return res.ok
        ? { sent: true }
        : { sent: false, reason: `HTTP ${res.status}` };
    } catch {
      return { sent: false, reason: "network-error" as const };
    }
  },
});
