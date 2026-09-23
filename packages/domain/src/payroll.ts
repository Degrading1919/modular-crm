import { DomainError } from "./errors.ts";

export interface CompensationInputs {
  approvedMinutes: number;
  hourlyRateCents: number;
  overtimeAfterMinutes?: number;
  overtimeMultiplier?: number;
  jobsCompleted?: number;
  perJobCents?: number;
  bonusCents?: number;
  commissionCents?: number;
  tipsCents?: number;
  mileageTenths?: number;
  mileageRateCentsPerMile?: number;
}

export function calculateGrossPay(input: CompensationInputs) {
  for (const value of Object.values(input)) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new DomainError("VALIDATION_ERROR", "Compensation inputs must be nonnegative.", 422);
  }
  const regularMinutes = Math.min(input.approvedMinutes, input.overtimeAfterMinutes ?? input.approvedMinutes);
  const overtimeMinutes = input.approvedMinutes - regularMinutes;
  const hourlyCents = Math.round(regularMinutes * input.hourlyRateCents / 60);
  const overtimeCents = Math.round(overtimeMinutes * input.hourlyRateCents * (input.overtimeMultiplier ?? 1.5) / 60);
  const perJobCents = (input.jobsCompleted ?? 0) * (input.perJobCents ?? 0);
  const mileageCents = Math.round((input.mileageTenths ?? 0) * (input.mileageRateCentsPerMile ?? 0) / 10);
  const bonusCents = input.bonusCents ?? 0;
  const commissionCents = input.commissionCents ?? 0;
  const tipsCents = input.tipsCents ?? 0;
  return { regularMinutes, overtimeMinutes, hourlyCents, overtimeCents, perJobCents, mileageCents, bonusCents, commissionCents, tipsCents,
    grossCents: hourlyCents + overtimeCents + perJobCents + mileageCents + bonusCents + commissionCents + tipsCents };
}
