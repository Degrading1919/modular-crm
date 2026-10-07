import type { Page } from "@playwright/test";

/** Choose the named record through the same remote search staff use. */
export async function chooseStaffRecord(page: Page, label: "Customer" | "Service" | `Catalog service ${number}`, name: string) {
  await page.getByRole("combobox", { name: label, exact: true }).fill(name);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("listbox", { name: `${label} choices` })
    .getByRole("option", { name: new RegExp(`^${escaped}(?: ·|$)`) }).click();
}
