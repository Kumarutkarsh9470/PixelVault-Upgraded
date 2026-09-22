// Neon's HTTP driver: one round trip per query, no connection pool to manage
// inside short-lived serverless functions.
import { neon } from "@neondatabase/serverless";

let client;

export function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    client = neon(url);
  }
  return client;
}
