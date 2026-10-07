import { createHmac, timingSafeEqual } from "node:crypto";
import { ConnectorError } from "../types.ts";

/** Verify the exact bytes before parsing JSON; allow multiple v1 values for secret rotation. */
export function verifyPaymentSignature(rawBody: string, signature: string, secret: string, now = new Date()): unknown {
  const parts = signature.split(",").map((part) => part.trim().split("="));
  const timestamps = parts.filter(([key]) => key === "t");
  const timestamp = timestamps[0]?.[1];
  if (timestamps.length !== 1 || !timestamp || !/^\d{1,12}$/.test(timestamp)
    || Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp)) > 300 || !secret || rawBody.length > 1_000_000) {
    throw new ConnectorError("invalid_webhook_signature", "Payment notification could not be verified", false);
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  if (!parts.some(([key, value]) => key === "v1" && typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)
    && timingSafeEqual(Buffer.from(value, "hex"), expected))) {
    throw new ConnectorError("invalid_webhook_signature", "Payment notification could not be verified", false);
  }
  try { return JSON.parse(rawBody); }
  catch { throw new ConnectorError("invalid_request", "Payment notification is invalid", false); }
}
