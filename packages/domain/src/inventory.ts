import { DomainError } from "./errors.ts";

export type StockMovementType = "receive" | "transfer_out" | "transfer_in" | "consume" | "return" | "adjust_up" | "adjust_down" | "sell";
export interface StockMovement { type: StockMovementType; quantity: number; itemId: string; stockLocationId: string; transferId?: string }

const positive = new Set<StockMovementType>(["receive", "transfer_in", "return", "adjust_up"]);
export function stockBalance(movements: ReadonlyArray<StockMovement>, itemId: string, stockLocationId: string): number {
  return movements.filter((m) => m.itemId === itemId && m.stockLocationId === stockLocationId)
    .reduce((sum, m) => {
      if (!Number.isInteger(m.quantity) || m.quantity <= 0) throw new DomainError("VALIDATION_ERROR", "Stock movement quantity must be a positive integer.", 422);
      return sum + (positive.has(m.type) ? m.quantity : -m.quantity);
    }, 0);
}

export function makeTransfer(input: { itemId: string; from: string; to: string; quantity: number; transferId: string }): [StockMovement, StockMovement] {
  if (input.from === input.to || !Number.isInteger(input.quantity) || input.quantity <= 0) throw new DomainError("VALIDATION_ERROR", "Invalid stock transfer.", 422);
  return [
    { type: "transfer_out", quantity: input.quantity, itemId: input.itemId, stockLocationId: input.from, transferId: input.transferId },
    { type: "transfer_in", quantity: input.quantity, itemId: input.itemId, stockLocationId: input.to, transferId: input.transferId },
  ];
}
