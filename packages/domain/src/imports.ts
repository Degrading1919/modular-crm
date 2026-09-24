import { createHash } from "node:crypto";
import { DomainError } from "./errors.ts";

export type ImportField = "name" | "email" | "phone" | "address" | "city" | "state" | "zip" | "customerType" | "petName" | "gateCode" | "frequency";
export interface ColumnMapping { source: string; target: ImportField | null; confidence: "high" | "medium" | "low"; reason: string }
export interface ImportPreview { headers: string[]; rows: Record<string, string>[]; mappings: ColumnMapping[]; duplicates: Array<{ row: number; existingCustomerId: string; reason: string }>; errors: Array<{ row: number; message: string }> }

const aliases: Record<ImportField, string[]> = {
  name: ["name", "customer", "customer name", "client", "client name", "full name", "company"],
  email: ["email", "email address", "e-mail"],
  phone: ["phone", "telephone", "mobile", "cell", "phone number"],
  address: ["address", "street", "street address", "service address"],
  city: ["city", "town"],
  state: ["state", "province"],
  zip: ["zip", "zipcode", "zip code", "postal code", "postcode"],
  customerType: ["customer type", "account type", "residential or commercial"],
  petName: ["dog name", "pet name", "pet 1", "dog 1"],
  gateCode: ["gate code", "access code"],
  frequency: ["frequency", "service frequency", "schedule"],
};

function normalizeHeading(value: string): string { return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " "); }

export function detectDelimiter(text: string): "," | "\t" | ";" {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", "\t", ";"] as const;
  return candidates.map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length - 1 })).sort((a, b) => b.count - a.count)[0]?.delimiter ?? ",";
}

export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  if (text.length > 10_000_000) throw new DomainError("VALIDATION_ERROR", "CSV file is too large.", 413);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else if (!quoted && cell.length === 0) quoted = true;
      else if (quoted) quoted = false;
      else throw new DomainError("VALIDATION_ERROR", `Unexpected quote at character ${i}.`, 422);
    } else if (char === delimiter && !quoted) {
      row.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new DomainError("VALIDATION_ERROR", "CSV has an unclosed quoted value.", 422);
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

export function inferMappings(headers: string[]): ColumnMapping[] {
  return headers.map((source) => {
    const normalized = normalizeHeading(source);
    const exact = (Object.entries(aliases) as [ImportField, string[]][]).find(([, names]) => names.includes(normalized));
    if (exact) return { source, target: exact[0], confidence: "high", reason: "Recognized heading" };
    const partial = (Object.entries(aliases) as [ImportField, string[]][]).filter(([, names]) => names.some((name) => normalized.includes(name) || name.includes(normalized)));
    if (partial.length === 1) return { source, target: partial[0]![0], confidence: "medium", reason: "Similar heading; confirm before import" };
    return { source, target: null, confidence: "low", reason: "Choose a field or ignore this column" };
  });
}

function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
function normalizePhone(value: string): string { return value.replace(/\D/g, ""); }

export function previewCustomerImport(csv: string, existing: Array<{ id: string; email?: string | null; phone?: string | null; name?: string | null }> = []): ImportPreview {
  const matrix = parseCsv(csv);
  if (matrix.length === 0) throw new DomainError("VALIDATION_ERROR", "CSV is empty.", 422);
  const headers = matrix[0]!.map((header) => header.trim());
  if (headers.length === 0 || headers.some((header) => !header)) throw new DomainError("VALIDATION_ERROR", "CSV needs named columns.", 422);
  const mappings = inferMappings(headers);
  const rows = matrix.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])));
  const duplicates: ImportPreview["duplicates"] = [];
  const errors: ImportPreview["errors"] = [];
  rows.forEach((row, index) => {
    const mapped = Object.fromEntries(mappings.filter((mapping) => mapping.target).map((mapping) => [mapping.target!, row[mapping.source]]));
    if (!mapped.name && !mapped.email) errors.push({ row: index + 2, message: "A name or email is required." });
    const candidate = existing.find((customer) =>
      (!!mapped.email && !!customer.email && normalizeEmail(mapped.email) === normalizeEmail(customer.email))
      || (!!mapped.phone && !!customer.phone && normalizePhone(mapped.phone) === normalizePhone(customer.phone) && normalizePhone(mapped.phone).length >= 7));
    if (candidate) duplicates.push({ row: index + 2, existingCustomerId: candidate.id, reason: mapped.email ? "Matching email or phone" : "Matching phone" });
  });
  return { headers, rows, mappings, duplicates, errors };
}

export function importRowKey(batchId: string, rowNumber: number, values: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify([batchId, rowNumber, Object.entries(values).sort()])).digest("hex");
}
