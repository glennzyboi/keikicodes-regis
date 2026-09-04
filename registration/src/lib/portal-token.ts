import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Parents never get a password.
 *
 * Registering and paying needs no account at all, because a login wall in front
 * of the money is friction that costs a registration. Coming back later to see
 * your registrations does need identity, so the confirmation email carries a
 * signed, expiring link.
 *
 * The token is HMAC-SHA256 over parentId and an expiry, base64url encoded. It is
 * stateless, so nothing extra to store, and it cannot be forged without the
 * secret. Thirty days, which is about one term.
 */
const SECRET = process.env.PORTAL_LINK_SECRET;
if (!SECRET) throw new Error("PORTAL_LINK_SECRET is not set");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function b64url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(payload: string) {
  return b64url(createHmac("sha256", SECRET!).update(payload).digest());
}

export function createPortalToken(parentId: string, ttlMs = THIRTY_DAYS_MS) {
  const expires = Date.now() + ttlMs;
  const payload = `${parentId}.${expires}`;
  return `${b64url(payload)}.${sign(payload)}`;
}

export function verifyPortalToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  let payload: string;
  try {
    payload = Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
  } catch {
    return null;
  }

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(parts[1]);
  // Constant time, so a wrong token cannot be guessed a byte at a time.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const [parentId, expires] = payload.split(".");
  if (!parentId || !expires) return null;
  if (Number(expires) < Date.now()) return null;

  return parentId;
}

export function portalUrl(parentId: string) {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base}/portal?t=${createPortalToken(parentId)}`;
}
