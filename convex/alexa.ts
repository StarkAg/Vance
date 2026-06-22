import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";

// Speak on the Echo Flex via Voice Monkey (voicemonkey.io) — a webhook→Alexa
// bridge that links through the OFFICIAL Voice Monkey Alexa skill (legitimate
// OAuth). No cookie scraping, no daily token, nothing for Amazon's fraud engine
// to flag. The live poll (convex/groww.ts) calls `announce` on danger alerts.
//
// One-time setup (only you can do the skill-link step):
//   1. Sign up at https://voicemonkey.io ("Login with Amazon").
//   2. In the Alexa app → Skills → enable "Voice Monkey" and link the account.
//   3. Create a Monkey (virtual trigger device) → note its device id.
//   4. From the Voice Monkey dashboard copy your API access token.
//   5. Point Convex at them (production deployment):
//        npx convex env set VOICEMONKEY_TOKEN  <access token>
//        npx convex env set VOICEMONKEY_DEVICE <device id>
//   6. Test:  npx convex run alexa:test
//
// API (v3): GET https://api-v3.voicemonkey.io/announce?token=&device=&text=
// The Flex speaks `text` immediately as a TTS announcement.

const ENDPOINT = "https://api-v3.voicemonkey.io/announce";

async function speak(text: string): Promise<{ ok: boolean; detail: string }> {
  const token = process.env.VOICEMONKEY_TOKEN;
  const device = process.env.VOICEMONKEY_DEVICE;
  if (!token || !device) {
    return { ok: false, detail: "VOICEMONKEY_TOKEN / VOICEMONKEY_DEVICE not set in Convex env" };
  }
  const url =
    `${ENDPOINT}?token=${encodeURIComponent(token)}` +
    `&device=${encodeURIComponent(device)}` +
    `&speech=${encodeURIComponent(text)}`; // v3 param is `speech`, not `text`
  try {
    const res = await fetch(url);
    const body = await res.text();
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    return { ok: true, detail: body.slice(0, 200) || "spoken" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// Internal — the poll fires this for danger-level position alerts.
export const announce = internalAction({
  args: { text: v.string() },
  handler: async (_ctx, { text }) => speak(text),
});

// Public — manual test from CLI or a dashboard button. Speaks a default line.
export const test = action({
  args: { text: v.optional(v.string()) },
  handler: async (_ctx, { text }) =>
    speak(text ?? "Vance is now connected. I will alert you on trade signals."),
});
