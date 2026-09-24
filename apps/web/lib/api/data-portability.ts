import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql, type SQL } from "drizzle-orm";
import {
  customerContacts, customers, importBatches, importRows, organizationLocations,
} from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { getDb } from "../db";
import type { SessionActor } from "./actor";
import { json } from "./http";

const MAX_REQUEST_BYTES = 3_200_000;
const MAX_CSV_BYTES = 1_500_000;
const MAX_CSV_ROWS = 5_000;
const MAX_EXPORT_ROWS = 25_000;
const MAX_BUSINESS_EXPORT_BYTES = 25_000_000;
const BUSINESS_EXPORT_PAGE_SIZE = 500;
const MAX_COLUMNS = 100;
const MAX_HEADER_CHARS = 200;
const MAX_CELL_CHARS = 20_000;
const BUSINESS_EXPORT_EXCLUDED_TABLES = new Set([
  "account", "session", "verification", "api_credentials", "connector_oauth_transactions", "payment_method_references",
]);
const BUSINESS_EXPORT_SENSITIVE_KEY = /password|secret|token|credential|authorization|api[_-]?key|access[_-]?instructions?|private[_-]?key|storage[_-]?key|signed[_-]?url|encrypted|verifier|signature|(?:^|[_-])hash(?:$|[_-])|(?:^|[_-])digest(?:$|[_-])/i;
const BUSINESS_EXPORT_NAME_OVERRIDES: Readonly<Record<string, string>> = { organization_locations: "locations" };
const IMPORT_FIELDS = ["name", "email", "phone", "address", "status", "notes"] as const;
type ImportField = (typeof IMPORT_FIELDS)[number];
type Delimiter = "," | ";" | "\t";
type StaffPortabilityActor = SessionActor & { kind: "staff"; membershipId: string; organizationId: string };

function requireStaffAccess(actor: SessionActor): asserts actor is StaffPortabilityActor {
  if (actor.kind !== "staff" || !actor.membershipId || !actor.organizationId) {
    throw new DomainError("FORBIDDEN", "Staff access is required.", 403);
  }
}

export interface CustomerCsvParseResult {
  delimiter: Delimiter;
  headers: string[];
  records: string[][];
}

export interface ColumnMappingInfo {
  source: string;
  target: ImportField | null;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface CustomerImportRow {
  row: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  status: string;
  notes: string;
}

export interface DuplicateCandidate {
  row: number;
  existingCustomerId?: string;
  candidateRow?: number;
  reason: string;
  name?: string;
}

const aliases: Record<ImportField, string[]> = {
  name: ["name", "customer", "customer name", "client", "client name", "full name", "company", "company name"],
  email: ["email", "email address", "e-mail", "e-mail address"],
  phone: ["phone", "phone number", "telephone", "mobile", "cell"],
  address: ["address", "street", "street address", "service address"],
  status: ["status", "customer status"],
  notes: ["notes", "note", "comments", "comment"],
};

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function rows(statement: SQL): Promise<Array<Record<string, unknown>>> {
  const result = await getDb().execute(statement);
  return result.rows as Array<Record<string, unknown>>;
}

function normalized(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), normalized(item)]));
  }
  return value;
}

function exportIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Unsafe business export SQL identifier.");
  return `"${value}"`;
}

function businessExportKey(tableName: string): string {
  return BUSINESS_EXPORT_NAME_OVERRIDES[tableName]
    ?? tableName.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function sensitiveExportField(key: string): boolean {
  // These two fields are references/statuses, not raw signature material.
  if (/^signature(?:_file_id|_valid|fileid|valid)$/i.test(key)) return false;
  return BUSINESS_EXPORT_SENSITIVE_KEY.test(key);
}

function removeSensitiveExportFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeSensitiveExportFields);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !sensitiveExportField(key))
    .map(([key, nested]) => [key, removeSensitiveExportFields(nested)]));
}

function looksBlank(record: string[]): boolean {
  return record.every((value) => value.trim() === "");
}

export function detectCsvDelimiter(csv: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let index = csv.charCodeAt(0) === 0xfeff ? 1 : 0; index < csv.length; index++) {
    const char = csv[index]!;
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && (char === "," || char === ";" || char === "\t")) counts[char]++;
  }
  return ([",", ";", "\t"] as const).reduce((best, item) => counts[item] > counts[best] ? item : best, ",");
}

/** RFC 4180 style CSV parsing with strict quote handling and bounded input. */
export function parseCsv(csv: string, delimiter: Delimiter = detectCsvDelimiter(csv)): string[][] {
  if (new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES) {
    throw new DomainError("VALIDATION_ERROR", "CSV file is too large.", 413);
  }
  const input = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const result: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let afterQuote = false;
  let recordHasInput = false;

  const pushCell = () => {
    if (cell.length > MAX_CELL_CHARS) throw new DomainError("VALIDATION_ERROR", "A CSV value is too long.", 422);
    record.push(cell);
    if (record.length > MAX_COLUMNS) throw new DomainError("VALIDATION_ERROR", "CSV has too many columns.", 422);
    cell = "";
    afterQuote = false;
  };
  const pushRecord = () => {
    pushCell();
    if (!looksBlank(record)) {
      result.push(record);
      if (result.length > MAX_CSV_ROWS + 1) throw new DomainError("VALIDATION_ERROR", "CSV has too many rows.", 422);
    }
    record = [];
    recordHasInput = false;
  };

  for (let index = 0; index < input.length; index++) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { cell += '"'; index++; }
        else { quoted = false; afterQuote = true; }
      } else cell += char;
      recordHasInput = true;
      continue;
    }

    if (afterQuote) {
      if (char === delimiter) pushCell();
      else if (char === "\n" || char === "\r") {
        if (char === "\r" && input[index + 1] === "\n") index++;
        pushRecord();
      } else if (char === " " || char === "\t") {
        // Whitespace between a closed quoted value and its separator is harmless.
      } else throw new DomainError("VALIDATION_ERROR", `Unexpected character after a quoted CSV value at character ${index}.`, 422);
      recordHasInput = true;
      continue;
    }

    if (char === delimiter) pushCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      pushRecord();
    } else if (char === '"') {
      if (cell.length !== 0) throw new DomainError("VALIDATION_ERROR", `Unexpected quote at character ${index}.`, 422);
      quoted = true;
      recordHasInput = true;
    } else {
      cell += char;
      if (cell.length > MAX_CELL_CHARS) throw new DomainError("VALIDATION_ERROR", "A CSV value is too long.", 422);
      recordHasInput = true;
    }
  }

  if (quoted) throw new DomainError("VALIDATION_ERROR", "CSV has an unclosed quoted value.", 422);
  if (recordHasInput || record.length > 0 || cell.length > 0 || afterQuote) pushRecord();
  return result;
}

export function parseCustomerCsv(csv: string): CustomerCsvParseResult {
  const matrix = parseCsv(csv);
  if (matrix.length === 0) throw new DomainError("VALIDATION_ERROR", "CSV is empty.", 422);
  const headers = matrix[0]!.map((header) => header.trim());
  if (headers.length === 0 || headers.some((header) => !header || header.length > MAX_HEADER_CHARS)) {
    throw new DomainError("VALIDATION_ERROR", "CSV needs named columns no longer than 200 characters.", 422);
  }
  const normalizedHeaders = headers.map(normalizeHeading);
  if (new Set(normalizedHeaders).size !== headers.length) {
    throw new DomainError("VALIDATION_ERROR", "CSV column names must be unique.", 422);
  }
  const reserved = new Set(["__proto__", "prototype", "constructor"]);
  if (headers.some((header) => reserved.has(header.toLowerCase()))) {
    throw new DomainError("VALIDATION_ERROR", "CSV contains a reserved column name.", 422);
  }
  return { delimiter: detectCsvDelimiter(csv), headers, records: matrix.slice(1) };
}

export function inferColumnMappings(headers: string[]): { mapping: Record<string, ImportField | null>; columnMappings: ColumnMappingInfo[] } {
  const infos: ColumnMappingInfo[] = headers.map((source) => {
    const normalized = normalizeHeading(source);
    const exact = (Object.entries(aliases) as [ImportField, string[]][])
      .find(([, names]) => names.some((name) => normalizeHeading(name) === normalized));
    if (exact) return { source, target: exact[0], confidence: "high", reason: "Recognized column name" };

    const padded = ` ${normalized} `;
    const candidates = new Set<ImportField>();
    for (const [target, names] of Object.entries(aliases) as [ImportField, string[]][]) {
      if (names.some((name) => padded.includes(` ${normalizeHeading(name)} `))) candidates.add(target);
    }
    if (candidates.size === 1) {
      return { source, target: [...candidates][0]!, confidence: "medium", reason: "Possible match; choose a field or ignore this column" };
    }
    if (candidates.size > 1) {
      return { source, target: null, confidence: "low", reason: "Several fields could match; choose a field or ignore this column" };
    }
    return { source, target: null, confidence: "low", reason: "No clear match; choose a field or ignore this column" };
  });

  const highCounts = new Map<ImportField, number>();
  for (const info of infos) if (info.confidence === "high" && info.target) highCounts.set(info.target, (highCounts.get(info.target) ?? 0) + 1);
  for (const info of infos) {
    if (info.confidence === "high" && info.target && (highCounts.get(info.target) ?? 0) > 1) {
      info.confidence = "medium";
      info.reason = "Several columns could fill this field; choose one or ignore this column";
    }
  }

  const mapping = Object.fromEntries(headers.map((header) => {
    const info = infos.find((candidate) => candidate.source === header)!;
    return [header, info.confidence === "high" ? info.target : null];
  })) as Record<string, ImportField | null>;
  return { mapping, columnMappings: infos };
}

interface ParsedRow {
  row: number;
  source: Record<string, string>;
  mapped: CustomerImportRow;
  errors: string[];
}

function mapCsvRow(headers: string[], values: string[], row: number, mapping: Record<string, ImportField | null>): ParsedRow {
  const source = Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])) as Record<string, string>;
  const mapped: CustomerImportRow = { row, name: "", email: "", phone: "", address: "", status: "", notes: "" };
  for (const [header, target] of Object.entries(mapping)) {
    if (target) mapped[target] = source[header] ?? "";
  }
  mapped.name = mapped.name.trim();
  mapped.email = mapped.email.trim().toLowerCase();
  mapped.phone = mapped.phone.trim();
  mapped.address = mapped.address.trim();
  mapped.status = mapped.status.trim().toLowerCase();
  mapped.notes = mapped.notes.trim();
  const errors: string[] = [];
  if (values.length > headers.length) errors.push("This row has more values than the header row.");
  if (!mapped.name && !mapped.email) errors.push("A customer name or email is required.");
  if (mapped.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mapped.email)) errors.push("Email address is not valid.");
  if (mapped.phone.length > 100) errors.push("Phone number is too long.");
  if (mapped.address.length > 2_000) errors.push("Address is too long.");
  if (mapped.status && !["active", "paused", "inactive", "blocked"].includes(mapped.status)) {
    errors.push("Status must be active, paused, inactive, or blocked.");
  }
  if (mapped.notes.length > 10_000) errors.push("Notes are too long.");
  return { row, source, mapped, errors };
}

function normalizedName(row: CustomerImportRow): string {
  return normalizeText(row.name || row.email);
}

function matchReason(row: CustomerImportRow, candidate: Candidate): string | null {
  const email = normalizeText(row.email);
  const candidateEmails = [candidate.email, candidate.contactEmail, ...(candidate.contactEmails ?? [])]
    .filter((value): value is string => !!value).map(normalizeText);
  const candidatePhones = [candidate.phone, candidate.contactPhone, ...(candidate.contactPhones ?? [])]
    .filter((value): value is string => !!value).map(normalizePhone);
  if (email && candidateEmails.includes(email)) return "Matching email";
  const phone = normalizePhone(row.phone);
  if (phone.length >= 7 && candidatePhones.includes(phone)) return "Matching phone";
  const address = normalizeText(row.address);
  if (address && candidate.address && address === normalizeText(candidate.address)) return "Matching address";
  const name = normalizedName(row);
  if (name && candidate.name && name === normalizeText(candidate.name)) return "Matching customer name";
  return null;
}

export interface Candidate {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactEmails?: string[];
  contactPhones?: string[];
  address?: string | null;
}

export function detectCustomerDuplicates(rowsToCheck: Array<{ row: number; mapped: CustomerImportRow }>, candidates: Candidate[]): DuplicateCandidate[] {
  const found: DuplicateCandidate[] = [];
  const earlierRows: Array<{ row: number; mapped: CustomerImportRow }> = [];
  for (const current of rowsToCheck) {
    const existing = candidates.map((candidate) => ({ candidate, reason: matchReason(current.mapped, candidate) }))
      .find((item) => item.reason !== null);
    if (existing) {
      found.push({ row: current.row, existingCustomerId: existing.candidate.id, reason: existing.reason!, name: existing.candidate.name });
    } else {
      const inFile = earlierRows.map((prior) => ({ prior, reason: matchReason(current.mapped, {
        id: `row-${prior.row}`, name: prior.mapped.name || prior.mapped.email, email: prior.mapped.email,
        phone: prior.mapped.phone, address: prior.mapped.address,
      }) })).find((item) => item.reason !== null);
      if (inFile) found.push({ row: current.row, candidateRow: inFile.prior.row, reason: inFile.reason!, name: inFile.prior.mapped.name || inFile.prior.mapped.email });
    }
    if (current.mapped.name || current.mapped.email || current.mapped.phone || current.mapped.address) earlierRows.push(current);
  }
  return found;
}

function normalizeRequestedMapping(
  headers: string[],
  inferred: Record<string, ImportField | null>,
  requested?: Record<string, string | null>,
): Record<string, ImportField | null> {
  const output: Record<string, ImportField | null> = { ...inferred };
  if (requested) {
    for (const [source, target] of Object.entries(requested)) {
      if (!headers.includes(source)) throw new DomainError("VALIDATION_ERROR", `Unknown CSV column: ${source}.`, 422);
      if (target !== null && target !== "" && !(IMPORT_FIELDS as readonly string[]).includes(target)) {
        throw new DomainError("VALIDATION_ERROR", `Unsupported customer field mapping for ${source}.`, 422);
      }
      output[source] = target && target !== "" ? target as ImportField : null;
    }
  }
  const targets = new Map<ImportField, string>();
  for (const [source, target] of Object.entries(output)) {
    if (!target) continue;
    const prior = targets.get(target);
    if (prior) throw new DomainError("VALIDATION_ERROR", `Choose only one column for ${target}.`, 422);
    targets.set(target, source);
  }
  return output;
}

function recordsToRows(headers: string[], records: string[][], mapping: Record<string, ImportField | null>): ParsedRow[] {
  return records.map((values, index) => mapCsvRow(headers, values, index + 2, mapping));
}

function previewRowObject(headers: string[], values: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])) as Record<string, string>;
}

function customerLocationScope(actor: SessionActor): SQL {
  if (actor.kind !== "staff") return sql`false`;
  if (actor.allLocations) return sql`true`;
  const locationIds = [...actor.locationIds];
  if (locationIds.length === 0) return sql`false`;
  return sql`c.owning_location_id IN (${sql.join(locationIds.map((locationId) => sql`${locationId}`), sql`, `)})`;
}

async function duplicateCandidates(executor: { execute: (query: SQL) => Promise<{ rows: unknown[] }> }, actor: SessionActor, rowsToCheck: ParsedRow[]): Promise<Candidate[]> {
  const valid = rowsToCheck.filter((row) => row.errors.length === 0).map((row) => row.mapped);
  if (valid.length === 0) return [];
  const emails = [...new Set(valid.map((row) => normalizeText(row.email)).filter(Boolean))];
  const phones = [...new Set(valid.map((row) => normalizePhone(row.phone)).filter((phone) => phone.length >= 7))];
  const names = [...new Set(valid.map(normalizedName).filter(Boolean))];
  const addresses = [...new Set(valid.map((row) => normalizeText(row.address)).filter(Boolean))];
  const contactConditions: SQL[] = [];
  if (emails.length) contactConditions.push(sql`lower(trim(cc.email)) IN (${sql.join(emails.map((value) => sql`${value}`), sql`, `)})`);
  if (phones.length) contactConditions.push(sql`regexp_replace(coalesce(cc.phone, ''), '[^0-9]', '', 'g') IN (${sql.join(phones.map((value) => sql`${value}`), sql`, `)})`);
  const matches: SQL[] = [];
  if (emails.length) matches.push(sql`lower(trim(c.billing_email)) IN (${sql.join(emails.map((value) => sql`${value}`), sql`, `)})`);
  if (phones.length) matches.push(sql`regexp_replace(coalesce(c.billing_phone, ''), '[^0-9]', '', 'g') IN (${sql.join(phones.map((value) => sql`${value}`), sql`, `)})`);
  if (names.length) matches.push(sql`regexp_replace(lower(trim(c.display_name)), '[[:space:]]+', ' ', 'g') IN (${sql.join(names.map((value) => sql`${value}`), sql`, `)})`);
  if (addresses.length) matches.push(sql`regexp_replace(lower(trim(coalesce(c.billing_address->>'line1', ''))), '[[:space:]]+', ' ', 'g') IN (${sql.join(addresses.map((value) => sql`${value}`), sql`, `)})`);
  if (contactConditions.length) matches.push(sql`EXISTS (SELECT 1 FROM customer_contacts cc WHERE cc.tenant_id = c.tenant_id AND cc.customer_id = c.id AND (${sql.join(contactConditions, sql` OR `)}))`);
  if (matches.length === 0) return [];

  const result = await executor.execute(sql`
    SELECT c.id::text AS id, c.display_name AS name, c.billing_email AS email, c.billing_phone AS phone,
      c.billing_address->>'line1' AS address, cc.email AS contact_email, cc.phone AS contact_phone
    FROM customers c
    LEFT JOIN customer_contacts cc ON cc.tenant_id = c.tenant_id AND cc.customer_id = c.id
    WHERE c.tenant_id = ${actor.tenantId} AND c.archived_at IS NULL
      AND ${customerLocationScope(actor)}
      AND (${sql.join(matches, sql` OR `)});
  `);
  const candidates = new Map<string, Candidate>();
  for (const raw of result.rows as Array<Record<string, unknown>>) {
    const id = String(raw.id);
    const current = candidates.get(id) ?? { id, name: String(raw.name ?? ""), email: raw.email as string | null, phone: raw.phone as string | null, address: raw.address as string | null, contactEmails: [], contactPhones: [] };
    if (raw.contact_email) current.contactEmails!.push(String(raw.contact_email));
    if (raw.contact_phone) current.contactPhones!.push(String(raw.contact_phone));
    candidates.set(id, current);
  }
  return [...candidates.values()];
}

function errorDetails(row: ParsedRow): Array<Record<string, string>> {
  return row.errors.map((message) => ({ code: "VALIDATION", message }));
}

function chooseImportLocation(actor: SessionActor, requestedLocationId?: unknown): string | null {
  requireStaffAccess(actor);
  if (requestedLocationId !== undefined && requestedLocationId !== null && typeof requestedLocationId !== "string") {
    throw new DomainError("VALIDATION_ERROR", "Choose a valid business location.", 422);
  }
  if (actor.allLocations) {
    if (typeof requestedLocationId === "string") return requestedLocationId;
    return actor.defaultLocationId ?? null;
  }
  const locations = [...actor.locationIds];
  if (typeof requestedLocationId === "string") {
    if (!actor.locationIds.has(requestedLocationId)) throw new DomainError("FORBIDDEN", "You do not have access to that business location.", 403);
    return requestedLocationId;
  }
  if (actor.defaultLocationId && actor.locationIds.has(actor.defaultLocationId)) return actor.defaultLocationId;
  if (locations.length === 1) return locations[0]!;
  if (locations.length === 0) throw new DomainError("FORBIDDEN", "You need an authorized business location to import customers.", 403);
  throw new DomainError("VALIDATION_ERROR", "Choose a default business location before importing customers.", 422);
}

async function verifyImportLocation(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  actor: StaffPortabilityActor,
  locationId: string | null,
): Promise<void> {
  if (!locationId) return;
  if (!actor.allLocations && !actor.locationIds.has(locationId)) {
    throw new DomainError("FORBIDDEN", "You do not have access to that business location.", 403);
  }
  const matches = await tx.select({ id: organizationLocations.id }).from(organizationLocations).where(and(
    eq(organizationLocations.id, locationId),
    eq(organizationLocations.tenantId, actor.tenantId),
    eq(organizationLocations.organizationId, actor.organizationId),
  )).limit(1);
  if (matches.length === 0) throw new DomainError("NOT_FOUND", "Business location not found.", 404);
}

interface ImportBody {
  csv: string;
  preview?: boolean;
  confirmed?: boolean;
  mapping?: Record<string, string | null>;
  idempotencyKey?: string;
  locationId?: string;
}

function parseImportBody(value: unknown): ImportBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("VALIDATION_ERROR", "Invalid import request.", 422);
  const body = value as Record<string, unknown>;
  if (typeof body.csv !== "string" || body.csv.length === 0) throw new DomainError("VALIDATION_ERROR", "Choose a CSV file to import.", 422);
  if (new TextEncoder().encode(body.csv).byteLength > MAX_CSV_BYTES) throw new DomainError("VALIDATION_ERROR", "CSV file is too large.", 413);
  if (body.preview !== undefined && typeof body.preview !== "boolean") throw new DomainError("VALIDATION_ERROR", "Invalid preview option.", 422);
  if (body.confirmed !== undefined && typeof body.confirmed !== "boolean") throw new DomainError("VALIDATION_ERROR", "Invalid confirmation option.", 422);
  if (body.mapping !== undefined) {
    if (!body.mapping || typeof body.mapping !== "object" || Array.isArray(body.mapping)) throw new DomainError("VALIDATION_ERROR", "Column mapping must be an object.", 422);
    if (Object.keys(body.mapping).length > MAX_COLUMNS) throw new DomainError("VALIDATION_ERROR", "Too many mapped columns.", 422);
    for (const target of Object.values(body.mapping)) {
      if (target !== null && typeof target !== "string") throw new DomainError("VALIDATION_ERROR", "Each mapped field must be a name or ignored.", 422);
    }
  }
  if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== "string" || body.idempotencyKey.trim().length === 0 || body.idempotencyKey.length > 200)) {
    throw new DomainError("VALIDATION_ERROR", "Provide a valid import retry key.", 422);
  }
  if (body.locationId !== undefined && typeof body.locationId !== "string") throw new DomainError("VALIDATION_ERROR", "Choose a valid business location.", 422);
  return body as unknown as ImportBody;
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REQUEST_BYTES) throw new DomainError("VALIDATION_ERROR", "Request is too large.", 413);
  if (!request.body) throw new DomainError("VALIDATION_ERROR", "Invalid JSON request.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new DomainError("VALIDATION_ERROR", "Request is too large.", 413);
    }
    chunks.push(next.value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
  catch { throw new DomainError("VALIDATION_ERROR", "Invalid JSON request.", 400); }
}

function previewErrors(parsedRows: ParsedRow[]): Array<{ row: number; message: string }> {
  return parsedRows.flatMap((row) => row.errors.map((message) => ({ row: row.row, message })));
}

async function previewImport(actor: SessionActor, body: ImportBody): Promise<Response> {
  requirePermission(actor, "customers.create");
  requireStaffAccess(actor);
  const parsed = parseCustomerCsv(body.csv);
  const inferred = inferColumnMappings(parsed.headers);
  const mapping = normalizeRequestedMapping(parsed.headers, inferred.mapping);
  const parsedRows = recordsToRows(parsed.headers, parsed.records, mapping);
  const candidates = await duplicateCandidates(getDb(), actor, parsedRows);
  const duplicates = detectCustomerDuplicates(parsedRows.filter((row) => row.errors.length === 0), candidates);
  const sampleRows = parsed.records.slice(0, 20).map((row) => previewRowObject(parsed.headers, row));
  return json({ item: {
    columns: parsed.headers,
    mapping,
    columnMappings: inferred.columnMappings,
    duplicates,
    rows: sampleRows,
    previewRows: sampleRows,
    rowCount: parsed.records.length,
    errors: previewErrors(parsedRows),
    delimiter: parsed.delimiter,
  } });
}

function responseFromStoredBatch(batch: typeof importBatches.$inferSelect, storedRows: Array<typeof importRows.$inferSelect>, idempotent: boolean): Response {
  const errorRows = storedRows.flatMap((row) => {
    if (row.status !== "failed") return [];
    const messages = Array.isArray(row.errors) ? row.errors as Array<{ message?: string }> : [];
    return messages.map((error) => ({ row: row.rowNumber, message: error.message ?? "This row could not be imported." }));
  });
  const duplicates = storedRows.flatMap((row) => {
    if (row.status !== "skipped_duplicate") return [];
    const details = Array.isArray(row.errors) ? row.errors[0] as Record<string, unknown> | undefined : undefined;
    if (!details) return [];
    return [{ row: row.rowNumber, ...(typeof details.existingCustomerId === "string" ? { existingCustomerId: details.existingCustomerId } : {}), ...(typeof details.candidateRow === "number" ? { candidateRow: details.candidateRow } : {}), reason: String(details.reason ?? "Possible duplicate"), ...(typeof details.name === "string" ? { name: details.name } : {}) }];
  });
  return json({ item: {
    batchId: batch.id,
    imported: batch.importedRows,
    skipped: batch.totalRows - batch.importedRows,
    errorRows,
    duplicates,
    errorSummary: batch.errorSummary ?? {},
    idempotent,
  } });
}

function chunked<T>(items: T[], size = 300): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) chunks.push(items.slice(offset, offset + size));
  return chunks;
}

async function commitImport(actor: SessionActor, body: ImportBody): Promise<Response> {
  requirePermission(actor, "customers.create");
  requireStaffAccess(actor);
  if (body.confirmed !== true) throw new DomainError("VALIDATION_ERROR", "Review the CSV preview and confirm before importing.", 422);
  const key = body.idempotencyKey?.trim();
  if (!key) throw new DomainError("VALIDATION_ERROR", "Provide an import retry key.", 422);
  const parsed = parseCustomerCsv(body.csv);
  const inferred = inferColumnMappings(parsed.headers);
  const mapping = normalizeRequestedMapping(parsed.headers, inferred.mapping, body.mapping);
  const parsedRows = recordsToRows(parsed.headers, parsed.records, mapping);
  const invalidRows = new Map(parsedRows.filter((row) => row.errors.length > 0).map((row) => [row.row, row]));
  const csvHash = digest(body.csv);
  const mappingHash = digest(JSON.stringify(Object.entries(mapping).sort(([left], [right]) => left.localeCompare(right))));
  const locationId = chooseImportLocation(actor, body.locationId);
  const db = getDb();

  return db.transaction(async (tx) => {
    // Serialize imports within a tenant so the idempotency lookup and duplicate check are atomic.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`customer-import:${actor.tenantId}`}, 0))`);
    const existingBatches = await tx.select().from(importBatches).where(and(
      eq(importBatches.tenantId, actor.tenantId),
      sql`${importBatches.mapping}->>'_idempotencyKey' = ${key}`,
    )).limit(1);
    const prior = existingBatches[0];
    if (prior) {
      const storedMapping = prior.mapping as Record<string, unknown>;
      if (storedMapping._sourceHash !== csvHash || storedMapping._mappingHash !== mappingHash || storedMapping._locationId !== locationId) {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "This retry key was already used for different import data.", 409);
      }
      const priorRows = await tx.select().from(importRows).where(and(eq(importRows.tenantId, actor.tenantId), eq(importRows.importBatchId, prior.id))).orderBy(importRows.rowNumber);
      return responseFromStoredBatch(prior, priorRows, true);
    }

    await verifyImportLocation(tx, actor, locationId);

    const duplicateMatches = await duplicateCandidates(tx, actor, parsedRows);
    const duplicateRows = detectCustomerDuplicates(parsedRows.filter((row) => row.errors.length === 0), duplicateMatches);
    const duplicatesByRow = new Map(duplicateRows.map((duplicate) => [duplicate.row, duplicate]));
    const [batch] = await tx.insert(importBatches).values({
      tenantId: actor.tenantId,
      sourceType: "csv",
      entityType: "customers",
      status: "committed",
      mapping: { ...mapping, _idempotencyKey: key, _sourceHash: csvHash, _mappingHash: mappingHash, _locationId: locationId, _mappingVersion: "v1" },
      totalRows: parsedRows.length,
      validRows: parsedRows.filter((row) => row.errors.length === 0).length,
      importedRows: 0,
      failedRows: invalidRows.size,
      createdByMembershipId: actor.membershipId!,
      committedAt: new Date(),
      errorSummary: {},
    }).returning();
    if (!batch) throw new Error("Could not create import batch.");

    const importable = parsedRows.filter((row) => row.errors.length === 0 && !duplicatesByRow.has(row.row));
    const newCustomerIds = new Map<number, string>();
    const customerValues = importable.map((row) => {
      const id = randomUUID();
      newCustomerIds.set(row.row, id);
      const fullName = row.mapped.name || row.mapped.email;
      return {
        id,
        tenantId: actor.tenantId,
        organizationId: actor.organizationId!,
        owningLocationId: locationId,
        customerType: "residential",
        status: row.mapped.status || "active",
        displayName: fullName,
        billingEmail: row.mapped.email || null,
        billingPhone: row.mapped.phone || null,
        billingAddress: row.mapped.address ? { line1: row.mapped.address } : null,
        customFields: {
          ...(row.mapped.notes ? { importNotes: row.mapped.notes } : {}),
          importBatchId: batch.id,
        },
      };
    });
    for (const group of chunked(customerValues)) await tx.insert(customers).values(group);

    const contacts = importable.map((row) => {
      const name = row.mapped.name || row.mapped.email;
      const pieces = name.trim().split(/\s+/).filter(Boolean);
      return {
        tenantId: actor.tenantId,
        customerId: newCustomerIds.get(row.row)!,
        firstName: pieces[0] ?? name,
        lastName: pieces.slice(1).join(" "),
        email: row.mapped.email || null,
        phone: row.mapped.phone || null,
        isPrimary: true,
        billingContact: true,
        serviceContact: true,
      };
    });
    for (const group of chunked(contacts)) await tx.insert(customerContacts).values(group);

    const importRowValues = parsedRows.map((row) => {
      const duplicate = duplicatesByRow.get(row.row);
      const errors = row.errors.length
        ? errorDetails(row)
        : duplicate
          ? [{ code: "POSSIBLE_DUPLICATE", ...duplicate }]
          : [];
      const status = row.errors.length ? "failed" : duplicate ? "skipped_duplicate" : "imported";
      return {
        id: randomUUID(),
        tenantId: actor.tenantId,
        importBatchId: batch.id,
        rowNumber: row.row,
        sourcePayload: row.source,
        normalizedPayload: { ...row.mapped, locationId },
        status,
        matchedEntityType: status === "imported" ? "customers" : duplicate?.existingCustomerId ? "customers" : null,
        matchedEntityId: status === "imported" ? newCustomerIds.get(row.row)! : duplicate?.existingCustomerId ?? null,
        errors,
      };
    });
    for (const group of chunked(importRowValues)) await tx.insert(importRows).values(group);

    const imported = importable.length;
    const skipped = parsedRows.length - imported;
    const errorSummary = {
      imported,
      skipped,
      duplicateCount: duplicateRows.length,
      errorCount: invalidRows.size,
      duplicates: duplicateRows,
      errors: previewErrors(parsedRows),
    };
    const [updatedBatch] = await tx.update(importBatches).set({
      importedRows: imported,
      failedRows: invalidRows.size,
      errorSummary,
    }).where(and(eq(importBatches.tenantId, actor.tenantId), eq(importBatches.id, batch.id))).returning();
    if (!updatedBatch) throw new Error("Could not update import summary.");
    const committedRows = await tx.select().from(importRows)
      .where(and(eq(importRows.tenantId, actor.tenantId), eq(importRows.importBatchId, batch.id)))
      .orderBy(importRows.rowNumber);
    return responseFromStoredBatch(updatedBatch, committedRows, false);
  });
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  const formula = /^[\s\u0000-\u001f\uFEFF]*[=+\-@]/.test(text);
  const safe = formula ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function encodeCsv(headers: string[], data: Array<Array<unknown>>): string {
  return `\uFEFF${[headers, ...data].map((record) => record.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

async function exportCustomers(actor: SessionActor): Promise<Response> {
  requirePermission(actor, "customers.export");
  requireStaffAccess(actor);
  const scoped = actor.allLocations ? sql`true` : actor.locationIds.size === 0 ? sql`false` : sql`c.owning_location_id IN (${sql.join([...actor.locationIds].map((id) => sql`${id}`), sql`, `)})`;
  const result = await rows(sql`
    SELECT c.display_name AS customer_name, c.company_name, c.billing_email AS email, c.billing_phone AS phone,
      c.status, c.customer_type, COALESCE(c.billing_address->>'line1', (
        SELECT sl.address_line1 FROM service_locations sl WHERE sl.tenant_id = c.tenant_id AND sl.customer_id = c.id
        ORDER BY sl.created_at LIMIT 1
      ), '') AS address, c.created_at
    FROM customers c
    WHERE c.tenant_id = ${actor.tenantId} AND c.archived_at IS NULL AND ${scoped}
    ORDER BY c.display_name, c.created_at
    LIMIT ${MAX_EXPORT_ROWS + 1};
  `);
  if (result.length > MAX_EXPORT_ROWS) throw new DomainError("VALIDATION_ERROR", "Customer export is too large for a single download.", 413);
  const header = ["Customer Name", "Company Name", "Email", "Phone", "Status", "Type", "Address", "Created At"];
  const body = result.map((row) => [row.customer_name, row.company_name, row.email, row.phone, row.status, row.customer_type, row.address, row.created_at]);
  return new Response(encodeCsv(header, body), { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": 'attachment; filename="customers.csv"',
    "cache-control": "no-store",
  } });
}

async function exportBusinessData(actor: SessionActor): Promise<Response> {
  requireStaffAccess(actor);
  if (actor.role !== "owner") throw new DomainError("FORBIDDEN", "Only a business owner can download a full business-data export.", 403);
  const tenantId = actor.tenantId;
  const exported = await getDb().transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    const queryRows = async (statement: SQL) => (await tx.execute(statement)).rows as Array<Record<string, unknown>>;
    const [tenant] = await queryRows(sql`
      SELECT id, name, slug, status, default_currency, default_timezone, industry_pack_key,
        industry_pack_version, settings, created_at, updated_at
      FROM tenants WHERE id = ${tenantId} LIMIT 1
    `);
    const columns = await queryRows(sql`
      SELECT c.table_name, c.column_name, c.ordinal_position, pk.primary_key_position
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      LEFT JOIN (
        SELECT tc.table_name, kcu.column_name, kcu.ordinal_position AS primary_key_position
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_catalog = tc.constraint_catalog
          AND kcu.constraint_schema = tc.constraint_schema
          AND kcu.constraint_name = tc.constraint_name
          AND kcu.table_name = tc.table_name
        WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
      ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position
    `);
    const tablePlans = new Map<string, { columns: string[]; primaryKey: Array<{ name: string; position: number }> }>();
    for (const column of columns) {
      const tableName = String(column.table_name);
      if (tableName === "tenants" || BUSINESS_EXPORT_EXCLUDED_TABLES.has(tableName)) continue;
      const columnName = String(column.column_name);
      const plan = tablePlans.get(tableName) ?? { columns: [], primaryKey: [] };
      if (!sensitiveExportField(columnName)) plan.columns.push(columnName);
      if (column.primary_key_position !== null && column.primary_key_position !== undefined
        && !sensitiveExportField(columnName)) {
        plan.primaryKey.push({ name: columnName, position: Number(column.primary_key_position) });
      }
      tablePlans.set(tableName, plan);
    }

    const data: Record<string, unknown> = {};
    let estimatedBytes = 1_000;
    for (const [tableName, plan] of tablePlans) {
      if (!plan.columns.includes("tenant_id")) continue;
      const orderColumns = plan.primaryKey.sort((a, b) => a.position - b.position).map(({ name }) => name);
      const orderBy = orderColumns.length ? orderColumns : plan.columns.filter((name) => name !== "tenant_id");
      const selectedColumns = sql.raw(plan.columns.map(exportIdentifier).join(", "));
      const relation = sql.raw(`"public".${exportIdentifier(tableName)}`);
      const ordering = sql.raw((orderBy.length ? orderBy : ["tenant_id"]).map(exportIdentifier).join(", "));
      const tableRows: Array<Record<string, unknown>> = [];
      let offset = 0;
      while (true) {
        const page = await queryRows(sql`
          SELECT ${selectedColumns} FROM ${relation}
          WHERE ${sql.raw(exportIdentifier("tenant_id"))} = ${tenantId}
          ORDER BY ${ordering} LIMIT ${BUSINESS_EXPORT_PAGE_SIZE} OFFSET ${offset}
        `);
        for (const row of page) {
          const safeRow = normalized(removeSensitiveExportFields(row)) as Record<string, unknown>;
          estimatedBytes += new TextEncoder().encode(JSON.stringify(safeRow)).byteLength;
          if (estimatedBytes > MAX_BUSINESS_EXPORT_BYTES) {
            throw new DomainError("VALIDATION_ERROR", "The business-data export is too large for a single download.", 413);
          }
          tableRows.push(safeRow);
        }
        if (page.length < BUSINESS_EXPORT_PAGE_SIZE) break;
        offset += page.length;
      }
      data[businessExportKey(tableName)] = tableRows;
    }

    const staff = [] as Array<Record<string, unknown>>;
    let staffOffset = 0;
    while (true) {
      const page = await queryRows(sql`
        SELECT m.id, m.tenant_id, m.user_id, u.name, u.email, u.email_verified, m.organization_id,
          m.default_location_id, m.role_template_id, m.status, m.invited_at, m.joined_at,
          m.last_active_at, m.created_at, m.updated_at
        FROM memberships m JOIN "user" u ON u.id = m.user_id
        WHERE m.tenant_id = ${tenantId}
        ORDER BY m.id LIMIT ${BUSINESS_EXPORT_PAGE_SIZE} OFFSET ${staffOffset}
      `);
      for (const row of page) {
        const safeRow = normalized(row) as Record<string, unknown>;
        estimatedBytes += new TextEncoder().encode(JSON.stringify(safeRow)).byteLength;
        if (estimatedBytes > MAX_BUSINESS_EXPORT_BYTES) {
          throw new DomainError("VALIDATION_ERROR", "The business-data export is too large for a single download.", 413);
        }
        staff.push(safeRow);
      }
      if (page.length < BUSINESS_EXPORT_PAGE_SIZE) break;
      staffOffset += page.length;
    }
    data.staff = staff;

    const fileRows = data.files as Array<Record<string, unknown>> | undefined;
    const fileManifest = (fileRows ?? []).map((file) => ({
      id: file.id, originalName: file.originalName, mimeType: file.mimeType, byteSize: file.byteSize,
      checksum: file.checksum, visibility: file.visibility, createdAt: file.createdAt,
    }));
    return { tenant: tenant ? normalized(removeSensitiveExportFields(tenant)) : null, data, fileManifest };
  });
  const payload = {
    schemaVersion: "modular-crm-business-data-v1",
    exportedAt: new Date().toISOString(),
    tenant: exported.tenant,
    data: exported.data,
    fileManifest: exported.fileManifest,
  };
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_BUSINESS_EXPORT_BYTES) {
    throw new DomainError("VALIDATION_ERROR", "The business-data export is too large for a single download.", 413);
  }
  return json(payload, 200, { "content-disposition": 'attachment; filename="business-data.json"' });
}

export async function handleDataPortability(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length === 1 && path[0] === "imports") {
    if (request.method !== "POST") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    const body = parseImportBody(await readBoundedJson(request));
    if (body.preview === true) return previewImport(actor, body);
    return commitImport(actor, body);
  }
  if (path.length === 2 && path[0] === "exports" && path[1] === "customers") {
    if (request.method !== "GET") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    return exportCustomers(actor);
  }
  if (path.length === 2 && path[0] === "exports" && path[1] === "business-data") {
    if (request.method !== "GET") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    return exportBusinessData(actor);
  }
  return null;
}
