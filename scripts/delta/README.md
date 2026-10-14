# Delta agent

Claude-per-bar decision loop on Delta Exchange India BTC perpetuals.

## Files

| file | role |
|---|---|
| `client.mjs` | HMAC-signed REST client. Testnet by default. |
| `brain.mjs` | One structured decision per bar: long / short / flat / hold. |
| `risk.mjs` | Hard limits. Every one is a veto. |
| `preflight.mjs` | Clock skew, key scope, IP whitelist, cost restatement. |
| `run.mjs` | The loop. |

## Running

```bash
npm run delta:preflight     # always first
npm run delta:dry           # decisions only, sends nothing — works with no Delta key
npm run delta:arm           # actually places orders
```

Live money needs **both** `--arm` and `DELTA_ENV=live`. Two gates on purpose.

## Config

All optional, all read from the environment.

| var | default | |
|---|---|---|
| `DELTA_ENV` | `testnet` | `live` switches base URL to `api.india.delta.exchange` |
| `DELTA_LEVERAGE` | `200` | |
| `DELTA_MAX_MARGIN` | `20` | USD of your own money at risk per position |
| `DELTA_MAX_NOTIONAL` | `2000` | USD position size cap |
| `DELTA_MAX_DAILY_LOSS` | `25` | USD; halts the loop |
| `DELTA_MAX_TRADES` | `10` | per UTC day |
| `DELTA_MAX_CONSEC_LOSSES` | `3` | halts the loop |
| `DELTA_MAX_SLIP_BPS` | `5` | abort if price moved this much since the decision |
| `DELTA_MAX_DECISION_AGE_MS` | `3000` | abort if the decision is older than this |
| `DELTA_MODEL` | `claude-opus-5` | |
| `DELTA_EFFORT` | `low` | raise only if decisions stay inside the staleness budget |

## Kill switch

```bash
touch scripts/delta/KILL      # refuses all new entries from the next tick
```
Removing the file re-enables. Existing positions are not closed by this — use Ctrl-C,
which flattens before exiting.

## Safety behaviours worth knowing

- **Flatten on exit.** SIGINT, SIGTERM, uncaught exception and normal loop exit all
  close the position first. An orphaned leveraged position with nothing watching it
  is the worst available outcome.
- **Sleep detector.** If the wall clock jumps more than 3 intervals the host slept;
  the loop flattens and halts rather than acting on a stale view.
- **Staleness gate.** A decision is rejected if it is older than
  `DELTA_MAX_DECISION_AGE_MS` or if price moved more than `DELTA_MAX_SLIP_BPS`
  between the snapshot Claude judged and the moment of sending.

## The economics, restated

Round trip is 0.10% of notional plus 18% GST. At 200x that is **23.6% of posted
margin per trade**, before any price movement. Ten round trips at that rate leave
6.8% of the starting margin. Break-even needs a 0.118% favourable move; liquidation
is about 0.5% away. `preflight.mjs` prints these against your actual limits.

Testnet order books are thin and often show zero volume, so testnet fills will look
better than live ones. Testnet validates the plumbing, not the slippage.
