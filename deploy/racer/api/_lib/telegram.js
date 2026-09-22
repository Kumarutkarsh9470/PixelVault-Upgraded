// Verifies Telegram Mini App launch data. Identity is Telegram's HMAC over the
// init data, keyed with our bot token: a client cannot forge who it is.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 24 * 60 * 60;

export class AuthError extends Error {}

export function verifyInitData(initData) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }
  if (!initData || typeof initData !== "string") {
    throw new AuthError("missing Telegram init data");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw new AuthError("init data has no hash");
  }
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new AuthError("init data signature is invalid");
  }

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) {
    throw new AuthError("init data has expired; reopen the Mini App");
  }

  const user = JSON.parse(params.get("user") || "null");
  if (!user || !user.id) {
    throw new AuthError("init data has no user");
  }
  return { id: user.id, username: user.username || null, firstName: user.first_name || null };
}
