#!/usr/bin/env node
// Generate a Groww API access token, then persist it to .env.local as
// GROWW_ACCESS_TOKEN. Designed to be re-run daily after the 6 AM reset.
//
// Two flows (auto-selected by which env vars are present):
//   TOTP flow      -> GROWW_TOTP_TOKEN (bearer, long-lived) + GROWW_TOTP_SECRET
//                     (base32 seed; the 6-digit code is generated internally)
//   Approval flow  -> GROWW_API_KEY (bearer) + GROWW_API_SECRET (checksum)
//
// Usage:
//   node scripts/groww-token.mjs                 # auto: TOTP if seed present, else approval
//   node scripts/groww-token.mjs --totp 123456   # force a specific 6-digit code
//
// Exit codes: 0 ok, 1 config error, 2 API error.

import { createHash, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// RFC 6238 TOTP (SHA-1, 6 digits, 30s step) from a base32 seed — no deps.
function totpFromSecret(base32, step = 30, digits = 6) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = '';
  for (const c of clean) {
    const idx = alphabet.indexOf(c);
    if (idx === -1) throw new Error(`Invalid base32 char in TOTP secret: ${c}`);
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Math.floor(Date.now() / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', bytes).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

const ENV_PATH = new URL('../.env.local', import.meta.url);
const TOKEN_URL = 'https://api.groww.in/v1/token/api/access';

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function setEnvVar(text, key, value) {
  const line = `${key}=${value}`; // raw JWT has no special chars needing quotes
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, line) : text.trimEnd() + `\n${line}\n`;
}

const raw = readFileSync(ENV_PATH, 'utf8');
const env = parseEnv(raw);

const totpArgIdx = process.argv.indexOf('--totp');
const totpArg = totpArgIdx !== -1 ? process.argv[totpArgIdx + 1] : null;

// Decide flow: TOTP if we have a seed/code + a TOTP token, else approval.
const useTotp = !!(totpArg || env.GROWW_TOTP_SECRET);

let bearer, body;
if (useTotp) {
  bearer = env.GROWW_TOTP_TOKEN || env.GROWW_API_KEY;
  if (!bearer) { console.error('Missing GROWW_TOTP_TOKEN (the long-lived TOTP token bearer).'); process.exit(1); }
  const code = totpArg || totpFromSecret(env.GROWW_TOTP_SECRET);
  body = { key_type: 'totp', totp: code };
} else {
  bearer = env.GROWW_API_KEY;
  if (!bearer) { console.error('Missing GROWW_API_KEY in .env.local'); process.exit(1); }
  if (!env.GROWW_API_SECRET) { console.error('Missing GROWW_API_SECRET (approval flow). Or set GROWW_TOTP_SECRET / pass --totp <code>.'); process.exit(1); }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const checksum = createHash('sha256').update(env.GROWW_API_SECRET + timestamp).digest('hex');
  body = { key_type: 'approval', checksum, timestamp };
}

console.log(`Requesting access token (${body.key_type} flow)…`);

const res = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${bearer}`,
    'Content-Type': 'application/json',
    'X-API-VERSION': '1.0',
    Accept: 'application/json',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
let data;
try { data = JSON.parse(text); } catch { data = text; }

if (!res.ok || (data && data.status === 'FAILURE')) {
  console.error(`Token request failed [HTTP ${res.status}]:`);
  console.error(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  process.exit(2);
}

const token = data.token || data.accessToken || data.access_token;
if (!token) {
  console.error('No token field in response:', JSON.stringify(data, null, 2));
  process.exit(2);
}

writeFileSync(ENV_PATH, setEnvVar(raw, 'GROWW_ACCESS_TOKEN', token));
console.log('✓ Access token saved to .env.local as GROWW_ACCESS_TOKEN');
if (data.expiry) console.log(`  expiry: ${data.expiry}`);
if (data.tokenRefId) console.log(`  tokenRefId: ${data.tokenRefId}`);
