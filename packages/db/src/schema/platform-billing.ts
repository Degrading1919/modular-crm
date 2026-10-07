import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./identity.ts";
import { record } from "./columns.ts";

export const platformSubscriptions = pgTable("platform_subscriptions", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id),
  planKey: text("plan_key").notNull(), status: text("status").notNull().default("trialing"),
  currency: text("currency").notNull().default("USD"), interval: text("interval").notNull().default("month"),
  includedSeats: integer("included_seats").notNull(), capabilities: text("capabilities").array().notNull(),
  provider: text("provider").notNull(), customerId: text("provider_customer_id"), subscriptionId: text("provider_subscription_id"),
  trialEnd: timestamp("trial_end", { withTimezone: true }).notNull(), periodEnd: timestamp("period_end", { withTimezone: true }),
  pastDueAt: timestamp("past_due_at", { withTimezone: true }), graceEnd: timestamp("grace_end", { withTimezone: true }),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("platform_subscriptions_customer_ux").on(t.provider, t.customerId), uniqueIndex("platform_subscriptions_subscription_ux").on(t.provider, t.subscriptionId), index("platform_subscriptions_status_idx").on(t.status)]);
export const platformBillingEvents = pgTable("platform_billing_events", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  provider: text("provider").notNull(), eventId: text("event_id").notNull(), type: text("type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  payloadHash: text("payload_hash").notNull(), outcome: text("outcome").notNull(),
}, t => [uniqueIndex("platform_billing_events_event_ux").on(t.provider, t.eventId)]);
export const platformBillingSessions = pgTable("platform_billing_sessions", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  purpose: text("purpose").notNull(), planKey: text("plan_key").notNull(), currency: text("currency").notNull(), interval: text("interval").notNull(),
  requestKey: text("request_key").notNull(), url: text("url"), providerReference: text("provider_reference"),
  completedAt: timestamp("completed_at", { withTimezone: true }), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
}, t => [uniqueIndex("platform_billing_sessions_request_ux").on(t.tenantId, t.requestKey)]);
