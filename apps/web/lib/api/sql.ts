import { sql, type SQL } from "drizzle-orm";
import { DomainError, requirePermission, type Permission } from "@modular-crm/domain";
import { getDb } from "../db";
import { type SessionActor } from "./actor";

export type DbRow = Record<string, unknown>;

export async function rows<T extends DbRow = DbRow>(statement: SQL): Promise<T[]> {
  const result = await getDb().execute(statement);
  return result.rows as T[];
}

export function identifier(name: string): SQL {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return sql.raw(`"${name}"`);
}

/** Bind UUIDs individually. Raw array interpolation is stringified by Drizzle's SQL template. */
export function uuidArray(ids: Iterable<string>): SQL {
  const values = [...ids];
  return values.length ? sql`array[${sql.join(values.map((id) => sql`${id}`), sql`, `)}]::uuid[]` : sql`array[]::uuid[]`;
}

export function normalized(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()), normalized(item)]));
  }
  return value;
}

export function first<T>(items: T[]): T {
  if (!items[0]) throw new DomainError("NOT_FOUND", "Record not found.", 404);
  return items[0];
}

export interface TableScope {
  table: string;
  permission: Permission;
  locationColumn?: string;
}

function staffScope(actor: SessionActor, locationColumn?: string): SQL {
  if (actor.kind !== "staff") throw new DomainError("FORBIDDEN", "Staff access is required.", 403);
  if (actor.role === "technician") throw new DomainError("FORBIDDEN", "Use your assigned work view.", 403);
  if (actor.allLocations || !locationColumn) return sql`true`;
  const ids = [...actor.locationIds];
  if (ids.length === 0) return sql`false`;
  return sql`${identifier(locationColumn)} = ANY(${uuidArray(ids)})`;
}

export async function scopedList(actor: SessionActor, scope: TableScope, limit = 100): Promise<DbRow[]> {
  requirePermission(actor, scope.permission);
  const statement = sql`select * from ${identifier(scope.table)} where tenant_id = ${actor.tenantId} and ${staffScope(actor, scope.locationColumn)} order by created_at desc limit ${Math.min(200, Math.max(1, limit))}`;
  return rows(statement);
}

export async function scopedGet(actor: SessionActor, scope: TableScope, id: string): Promise<DbRow> {
  requirePermission(actor, scope.permission);
  return first(await rows(sql`select * from ${identifier(scope.table)} where id = ${id} and tenant_id = ${actor.tenantId} and ${staffScope(actor, scope.locationColumn)} limit 1`));
}

function valuesSql(values: Record<string, unknown>): { columns: SQL; parameters: SQL } {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  if (entries.length === 0) throw new DomainError("VALIDATION_ERROR", "No values supplied.", 422);
  return {
    columns: sql.join(entries.map(([column]) => identifier(column)), sql`, `),
    parameters: sql.join(entries.map(([, value]) => value !== null && typeof value === "object" && !(value instanceof Date) ? sql`${JSON.stringify(value)}::jsonb` : sql`${value}`), sql`, `),
  };
}

export async function scopedInsert(actor: SessionActor, scope: TableScope, values: Record<string, unknown>): Promise<DbRow> {
  requirePermission(actor, scope.permission);
  if (actor.kind !== "staff" || actor.role === "technician") throw new DomainError("FORBIDDEN", "Staff access is required.", 403);
  if (scope.locationColumn && values[scope.locationColumn] && !actor.allLocations && !actor.locationIds.has(String(values[scope.locationColumn]))) {
    throw new DomainError("NOT_FOUND", "Location not found.", 404);
  }
  const fields = valuesSql({ ...values, tenant_id: actor.tenantId });
  return first(await rows(sql`insert into ${identifier(scope.table)} (${fields.columns}) values (${fields.parameters}) returning *`));
}

export async function scopedUpdate(actor: SessionActor, scope: TableScope, id: string, values: Record<string, unknown>): Promise<DbRow> {
  await scopedGet(actor, scope, id);
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  if (entries.length === 0) throw new DomainError("VALIDATION_ERROR", "No changes supplied.", 422);
  const assignments = sql.join(entries.map(([column, value]) => sql`${identifier(column)} = ${value !== null && typeof value === "object" && !(value instanceof Date) ? sql`${JSON.stringify(value)}::jsonb` : sql`${value}`}`), sql`, `);
  return first(await rows(sql`update ${identifier(scope.table)} set ${assignments}, updated_at = now() where id = ${id} and tenant_id = ${actor.tenantId} and ${staffScope(actor, scope.locationColumn)} returning *`));
}

export async function belongsToTenant(table: string, id: string, tenantId: string): Promise<boolean> {
  return (await rows(sql`select id from ${identifier(table)} where id = ${id} and tenant_id = ${tenantId} limit 1`)).length > 0;
}

export async function assertBelongsToTenant(table: string, id: string, tenantId: string): Promise<void> {
  if (!await belongsToTenant(table, id, tenantId)) throw new DomainError("NOT_FOUND", "Related record not found.", 404);
}
