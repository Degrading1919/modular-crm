import { sql } from "drizzle-orm";
import { bigint, boolean, jsonb, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const utcNow = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
export const jsonObject = (name: string) => jsonb(name).$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`);
export const jsonArray = (name: string) => jsonb(name).$type<unknown[]>().notNull().default(sql`'[]'::jsonb`);
export const money = (name: string) => bigint(name, { mode: "bigint" }).notNull().default(sql`0`);
export const currency = (name = "currency") => varchar(name, { length: 3 }).notNull().default("USD");
export const status = (name = "status") => text(name).notNull();
export const active = () => boolean("active").notNull().default(true);

// A fresh set of builders is required for each pgTable declaration.
export const record = () => ({
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: utcNow(),
  updatedAt: updatedAt(),
});
