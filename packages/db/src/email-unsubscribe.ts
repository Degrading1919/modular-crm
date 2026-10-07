import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { type Database } from "./client.ts";
import { consentRecords, customers, outboundMessages } from "./schema/index.ts";

type Target = { tenantId: string; customerId: string; messageId: string };
function unsubscribeKey(secret: string) {
  return Buffer.from(hkdfSync("sha256", secret, "modular-crm", "email-unsubscribe-signing-v1", 32));
}
export function emailUnsubscribeToken(target: Target, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, ...target })).toString("base64url");
  return `${payload}.${createHmac("sha256", unsubscribeKey(secret)).update(`email-unsubscribe:${payload}`).digest("base64url")}`;
}
export function readEmailUnsubscribeToken(token: string, secret: string): Target | undefined {
  if (token.length > 1024) return;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return;
  const actual = Buffer.from(signature, "base64url");
  // One-release bridge for links signed before key separation; not a bridge across root-secret rotations.
  const valid = [unsubscribeKey(secret), secret].some((key) => {
    const expected = createHmac("sha256", key).update(`email-unsubscribe:${payload}`).digest();
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!valid) return;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Target & { v: number };
    if (parsed.v !== 1 || ![parsed.tenantId, parsed.customerId, parsed.messageId].every((id) => typeof id === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) return;
    return { tenantId: parsed.tenantId, customerId: parsed.customerId, messageId: parsed.messageId };
  } catch { return; }
}
export async function emailUnsubscribeTarget(db: Database, token: string, secret: string): Promise<Target | undefined> {
  const target = readEmailUnsubscribeToken(token, secret);
  if (!target) return;
  const [row] = await db.select({ category: outboundMessages.category }).from(outboundMessages).where(and(
    eq(outboundMessages.id, target.messageId), eq(outboundMessages.tenantId, target.tenantId),
    eq(outboundMessages.customerId, target.customerId), eq(outboundMessages.channel, "email"),
  )).limit(1);
  if (!row || ["service", "account", "transactional"].includes(row.category)) return;
  return target;
}
/** Signed authority only permits opting out of this customer's nontransactional email. */
export async function unsubscribeEmail(db: Database, token: string, secret: string, now = new Date()): Promise<boolean> {
  const target = await emailUnsubscribeTarget(db, token, secret);
  if (!target) return false;
  return db.transaction(async (tx) => {
    const [customer] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, target.customerId), eq(customers.tenantId, target.tenantId))).for("update").limit(1);
    if (!customer) return false;
    const [latest] = await tx.select().from(consentRecords).where(and(eq(consentRecords.tenantId, target.tenantId), eq(consentRecords.customerId, target.customerId), eq(consentRecords.channel, "email"), eq(consentRecords.category, "marketing"))).orderBy(desc(consentRecords.capturedAt)).limit(1);
    if (latest?.state !== "opted_out") await tx.insert(consentRecords).values({ tenantId: target.tenantId, customerId: target.customerId,
      channel: "email", category: "marketing", state: "opted_out", source: "email_unsubscribe", capturedAt: now, actorType: "customer", evidence: { messageId: target.messageId } });
    return true;
  });
}
