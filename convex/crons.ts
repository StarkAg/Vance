import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

// Persist the day's Groww orders after market close so history accumulates even
// if the app is never opened. 10:30 UTC = 16:00 IST (NSE closes 15:30 IST).
// Requires GROWW_TOTP_TOKEN + GROWW_TOTP_SECRET set in the Convex deployment.
const crons = cronJobs();

crons.daily("sync groww orders", { hourUTC: 10, minuteUTC: 30 }, api.groww.syncOrders, {});

export default crons;
