import { createHmac, timingSafeEqual } from "crypto";

export function secretsEqual(provided: string, expected: string) {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Generates a deterministic per-tenant HMAC token derived from the Evolution
 * secret + tenant slug so webhooks can authenticate safely via URL query or
 * header without exposing the raw Evolution API key.
 */
export function evolutionWebhookToken(secret: string, slug: string) {
  const cleanSecret = secret.trim();
  const cleanSlug = slug.trim().toLowerCase();
  if (!cleanSecret || !cleanSlug) return "";
  return createHmac("sha256", cleanSecret)
    .update(`evolution-webhook:${cleanSlug}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyEvolutionWebhookAuth(input: {
  expectedSecret: string;
  slug: string;
  headerSecret?: string | null;
  bodySecret?: string | null;
  queryToken?: string | null;
  headerToken?: string | null;
}) {
  const expectedSecret = input.expectedSecret.trim();
  if (!expectedSecret) return false;

  const headerSecret = (input.headerSecret ?? "").trim();
  if (headerSecret && secretsEqual(headerSecret, expectedSecret)) {
    return true;
  }

  const bodySecret = (input.bodySecret ?? "").trim();
  if (bodySecret && secretsEqual(bodySecret, expectedSecret)) {
    return true;
  }

  const expectedToken = evolutionWebhookToken(expectedSecret, input.slug);
  if (!expectedToken) return false;

  const queryToken = (input.queryToken ?? "").trim();
  if (queryToken && secretsEqual(queryToken, expectedToken)) {
    return true;
  }

  const headerToken = (input.headerToken ?? "").trim();
  if (headerToken && secretsEqual(headerToken, expectedToken)) {
    return true;
  }

  return false;
}
