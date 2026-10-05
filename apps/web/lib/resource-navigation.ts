export type ListRecord = { id: string; status?: unknown };
export type RecordDestination = { href: string; label: string };
/** A custom resolver replaces generic details entirely; null is a non-linked row. */
export type RecordNavigation = false | ((record: ListRecord) => RecordDestination | null);

export function recordDestination(resourceKey: string, record: ListRecord, navigation?: RecordNavigation): RecordDestination | null {
  if (navigation === false) return null;
  if (navigation) return navigation(record);
  return { href: `/app/${resourceKey}/${record.id}`, label: "View" };
}

export function paymentReceiptDestination(record: ListRecord): RecordDestination | null {
  return ["succeeded", "refunded", "partially_refunded"].includes(String(record.status))
    ? { href: `/app/documents/receipt/${record.id}`, label: "View receipt" }
    : null;
}
