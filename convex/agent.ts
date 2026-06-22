"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";

// Agentic position review — the "brain" of Vance. Reads the latest live F&O
// snapshot (built by groww.ts → pollPosition) and asks Claude Opus 4.8 to reason
// about each open contract toward the goal: PROTECT CAPITAL / BOOK PROFIT. It
// emits a HOLD / TRIM / EXIT verdict per contract with a reason and confidence,
// and writes one review row the Agent tab subscribes to.
//
// PROPOSE-ONLY by design: this action never calls Groww and never places an
// order. Order placement stays on the whitelisted VM (see the live-trading
// architecture). The human reads the verdicts and acts. Cost is controlled by
// skipping the model entirely when there are no open positions.

const MODEL = "claude-opus-4-8";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

type Position = {
  symbol: string;
  underlying: string;
  strike: number;
  isCall: boolean;
  entry: number;
  qty: number;
  ltp: number;
  uLtp: number;
  intrinsic: number;
  timeValue: number;
  pnl: number;
  pnlPct: number;
  dayChange: number;
  oiChange: number;
  oco: { target: number | null; stop: number | null } | null;
  suggestedStop: number | null;
  daysToExpiry: number | null;
  expiry: string;
  urgency: "ok" | "warn" | "danger";
  recs: string[];
};
type Snapshot = { positions: Position[]; marketOpen: boolean; fetchedAtIST: string };

const SYSTEM = `You are a disciplined F&O risk manager for an Indian options trader (NSE, weekly/monthly index & stock options). Your sole goal is to PROTECT CAPITAL and BOOK PROFIT — not to chase upside.

For every open position you must return one action:
- EXIT  — square off the whole position now. Use when: no active OCO/stop AND the trade is in profit (protect gains) or losing (cap the loss); ≤2 days to expiry (theta cliff on a long option); thesis clearly broken (underlying moving against the option with OI confirming).
- TRIM  — book part of the position, ride the rest. Use when: in solid profit with momentum still up and protection in place — lock some in, trail the rest.
- HOLD  — keep as-is. Use when: protected by an OCO, healthy time to expiry, and the move is intact.

Principles:
- An unprotected position (no OCO/stop) is the single biggest risk — bias toward EXIT or demand a stop.
- Long options bleed theta; near expiry, time value collapses — prefer EXIT over hope.
- Booked profit beats paper profit. When in doubt on a winner, TRIM.
- Be decisive and specific. Each reason must be one line a trader can act on immediately, referencing the actual numbers (P&L %, days to expiry, whether a stop exists).
- confidence reflects how clear the call is given the data.

Return ONLY the structured object. No preamble.`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "One or two sentences on the overall book: total risk posture and the single most important action.",
    },
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          action: { type: "string", enum: ["HOLD", "TRIM", "EXIT"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          reason: { type: "string", description: "One actionable line citing the numbers." },
        },
        required: ["symbol", "action", "confidence", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "verdicts"],
  additionalProperties: false,
};

export const reviewPositions = action({
  args: {},
  handler: async (ctx): Promise<{ reviewed: number; skipped?: string }> => {
    const snap = await ctx.runQuery(internal.growwStore.latestSnapshot, {});
    let data: Snapshot | null = null;
    try {
      data = snap?.payload ? (JSON.parse(snap.payload) as Snapshot) : null;
    } catch {
      data = null;
    }
    const positions = data?.positions ?? [];
    const now = Date.now();

    // No open positions → nothing to manage. Write an empty review and skip the
    // model call entirely (keeps cost near zero while flat).
    if (positions.length === 0) {
      await ctx.runMutation(internal.growwStore.putAgentReview, {
        updatedAt: now,
        payload: JSON.stringify({
          summary: "No open positions — nothing to manage.",
          verdicts: [],
          model: MODEL,
          marketOpen: data?.marketOpen ?? false,
          basedOnSnapshotAt: snap?.updatedAt ?? null,
        }),
      });
      return { reviewed: 0, skipped: "no open positions" };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set on the Convex deployment");

    // Trim each position to the fields the model needs to reason.
    const brief = positions.map((p) => ({
      symbol: p.symbol,
      type: p.isCall ? "CALL" : "PUT",
      underlying: p.underlying,
      strike: p.strike,
      qty: p.qty,
      entry: p.entry,
      ltp: p.ltp,
      underlyingSpot: p.uLtp,
      intrinsic: p.intrinsic,
      timeValue: p.timeValue,
      pnl: p.pnl,
      pnlPct: p.pnlPct,
      optionDayChangePct: p.dayChange,
      oiDayChangePct: p.oiChange,
      hasActiveStop: p.oco != null,
      ocoTarget: p.oco?.target ?? null,
      ocoStop: p.oco?.stop ?? null,
      daysToExpiry: p.daysToExpiry,
    }));

    const userContent = `Market is ${data?.marketOpen ? "OPEN" : "CLOSED"} (${data?.fetchedAtIST ?? "?"}). Review these open positions and return a verdict for each.\n\n${JSON.stringify(brief, null, 2)}`;

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM,
        messages: [{ role: "user", content: userContent }],
        output_config: { format: { type: "json_schema", schema: SCHEMA }, effort: "medium" },
      }),
    });

    const body = (await res.json().catch(() => null)) as
      | { content?: Array<{ type: string; text?: string }>; stop_reason?: string; error?: { message?: string } }
      | null;

    if (!res.ok) {
      throw new Error(`Claude review failed (HTTP ${res.status}): ${body?.error?.message ?? "unknown"}`);
    }
    if (body?.stop_reason === "refusal") {
      throw new Error("Claude declined the review request (refusal).");
    }

    const text = body?.content?.find((b) => b.type === "text")?.text ?? "";
    let parsed: { summary: string; verdicts: unknown[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Could not parse Claude review output: ${text.slice(0, 200)}`);
    }

    await ctx.runMutation(internal.growwStore.putAgentReview, {
      updatedAt: Date.now(),
      payload: JSON.stringify({
        summary: parsed.summary,
        verdicts: parsed.verdicts,
        model: MODEL,
        marketOpen: data?.marketOpen ?? false,
        basedOnSnapshotAt: snap?.updatedAt ?? null,
      }),
    });

    return { reviewed: positions.length };
  },
});
