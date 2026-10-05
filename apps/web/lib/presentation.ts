export function reportValue(key: string, value: unknown, currency = "USD"): string {
  if (value === null || value === undefined) return "—";
  if (/Cents$/.test(key)) return Number.isFinite(Number(value))
    ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value) / 100) : "—";
  if (["leadConversionRate", "estimateConversionRate", "completionRate"].includes(key) || key.startsWith("leadConversion_")) return `${value}%`;
  return String(value);
}

export function balanceTotals(invoices: readonly Record<string, unknown>[]): { currency: string; cents: number }[] {
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    const currency = String(invoice.currency ?? "USD");
    totals.set(currency, (totals.get(currency) ?? 0) + Number(invoice.openBalanceCents ?? 0));
  }
  return [...totals].map(([currency, cents]) => ({ currency, cents }));
}
