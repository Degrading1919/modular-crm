export function moneyValue(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
}

export function reportColumns(row: Record<string, unknown>): { key: string; label: string }[] {
  const labels: Record<string, string> = {
    locationName: "Location", staffName: "Team member", itemName: "Item",
    invoicedCents: "Invoiced", collectedCents: "Collected", outstandingCents: "Open balance",
    refundsCents: "Refunds", currentCents: "Not overdue", days1To30Cents: "1–30 days overdue",
    days31To60Cents: "31–60 days overdue", days61To90Cents: "61–90 days overdue", over90DaysCents: "Over 90 days overdue",
    revenueCents: "Service price inputs", revenuePerHourCents: "Price inputs per service hour", currency: "Currency",
  };
  return Object.keys(row).filter((key) => !/Id$/.test(key)).map((key) => ({ key,
    label: labels[key] ?? key.replace(/Cents$/, "").replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()),
  }));
}

export function reportValue(key: string, value: unknown, currency = "USD"): string {
  if (value === null || value === undefined) return "—";
  if (/Cents$/.test(key)) return Number.isFinite(Number(value))
    ? moneyValue(Number(value), currency) : "—";
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
