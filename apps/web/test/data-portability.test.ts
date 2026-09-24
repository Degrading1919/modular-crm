import { describe, expect, it } from "vitest";
import { detectCsvDelimiter, detectCustomerDuplicates, encodeCsv, inferColumnMappings, parseCsv, parseCustomerCsv } from "../lib/api/data-portability.ts";

describe("customer CSV portability helpers", () => {
  it("parses quoted delimiters, escaped quotes, embedded newlines, and CRLF rows", () => {
    const source = '\uFEFFName,Email,Notes\r\n"Ana, Carter",ana@example.test,"Gate says ""use side door""\nand ring"\r\n';
    expect(parseCsv(source)).toEqual([
      ["Name", "Email", "Notes"],
      ["Ana, Carter", "ana@example.test", 'Gate says "use side door"\nand ring'],
    ]);
    expect(parseCustomerCsv("Name;Email\nAna;ana@example.test").delimiter).toBe(";");
    expect(detectCsvDelimiter('Name\tEmail\n"Ana, Carter"\tana@example.test')).toBe("\t");
  });

  it("rejects malformed quoting, duplicate headings, and oversized CSV values", () => {
    expect(() => parseCsv('Name,Email\nAna,"ana@example.test')).toThrow("unclosed quoted");
    expect(() => parseCsv('Name,Email\nAna" Carter,ana@example.test')).toThrow("Unexpected quote");
    expect(() => parseCustomerCsv("Name,name\nAna,Ana")).toThrow("must be unique");
    expect(() => parseCsv(`Name\n${"x".repeat(20_001)}`)).toThrow("value is too long");
  });

  it("auto maps clear headings and leaves medium or unknown columns for an explicit choice", () => {
    const result = inferColumnMappings(["Customer Name", "Email", "Primary Phone Number", "Source System"]);
    expect(result.mapping).toEqual({
      "Customer Name": "name",
      Email: "email",
      "Primary Phone Number": null,
      "Source System": null,
    });
    expect(result.columnMappings.map(({ confidence }) => confidence)).toEqual(["high", "high", "medium", "low"]);
  });

  it("escapes CSV cells and neutralizes spreadsheet formulas", () => {
    const csv = encodeCsv(["Name", "Notes"], [["Ana, Carter", " =HYPERLINK(\"https://example.test\")"]]);
    expect(csv).toContain('"Ana, Carter"');
    expect(csv).toContain('"\' =HYPERLINK(""https://example.test"")"');
  });

  it("reports existing and in-file duplicate candidates without merging rows", () => {
    const mapped = (row: number, name: string, email: string) => ({ row, mapped: { row, name, email, phone: "", address: "", status: "", notes: "" } });
    const duplicates = detectCustomerDuplicates(
      [mapped(2, "Ana Carter", "ana@example.test"), mapped(3, "Bea Miles", "bea@example.test"), mapped(4, "Bea Miles", "BEA@example.test")],
      [{ id: "customer-1", name: "Ana Carter", email: "ana@example.test" }],
    );
    expect(duplicates).toEqual([
      { row: 2, existingCustomerId: "customer-1", reason: "Matching email", name: "Ana Carter" },
      { row: 4, candidateRow: 3, reason: "Matching email", name: "Bea Miles" },
    ]);
  });
});
