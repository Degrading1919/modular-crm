/** Amounts are stored in currency minor units, including zero/three-decimal currencies. */
export function moneyValue(minor: number, currency = "USD"): string {
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
  return formatter.format(minor / 10 ** formatter.resolvedOptions().maximumFractionDigits!);
}
