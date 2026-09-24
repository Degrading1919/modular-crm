import { DomainError } from "./errors.ts";

const transitions = {
  lead: {
    new: ["contacted", "qualified", "converted", "lost", "disqualified"],
    contacted: ["qualified", "quoted", "converted", "lost", "disqualified"],
    qualified: ["quoted", "converted", "lost", "disqualified"],
    quoted: ["converted", "lost", "disqualified"],
    lost: ["contacted", "qualified"],
    disqualified: [],
    converted: [],
  },
  estimate: {
    draft: ["sent", "canceled"], sent: ["viewed", "approved", "declined", "expired", "canceled"],
    viewed: ["approved", "declined", "expired", "canceled"], declined: ["draft"], expired: ["draft"], approved: [], canceled: [],
  },
  servicePlan: {
    draft: ["active", "canceled"], active: ["paused", "ended", "canceled"], paused: ["active", "ended", "canceled"], ended: [], canceled: [],
  },
  job: {
    draft: ["unscheduled", "scheduled", "canceled"], unscheduled: ["scheduled", "canceled"],
    scheduled: ["dispatched", "canceled", "missed", "skipped"], dispatched: ["en_route", "in_progress", "canceled", "missed", "skipped"],
    en_route: ["in_progress", "skipped", "missed", "canceled"], in_progress: ["paused", "completed", "skipped", "needs_return", "canceled"],
    paused: ["in_progress", "skipped", "canceled"], completed: ["needs_return"], skipped: [], missed: ["scheduled"], canceled: [], needs_return: [],
  },
  route: {
    draft: ["optimized", "published", "canceled"], optimized: ["optimized", "published", "canceled"],
    published: ["in_progress", "optimized", "completed", "canceled"], in_progress: ["completed", "optimized", "canceled"], completed: [], canceled: [],
  },
  invoice: {
    draft: ["issued", "void"], issued: ["partially_paid", "paid", "void", "overdue", "written_off"],
    partially_paid: ["paid", "overdue", "written_off"], overdue: ["partially_paid", "paid", "written_off"], paid: [], void: [], written_off: [],
  },
  ticket: {
    open: ["in_progress", "resolved", "canceled"], in_progress: ["waiting_on_customer", "resolved", "canceled"],
    waiting_on_customer: ["in_progress", "resolved", "canceled"], resolved: ["closed", "in_progress"], closed: ["in_progress"], canceled: [],
  },
  changeRequest: {
    submitted: ["reviewing", "withdrawn"], reviewing: ["approved", "rejected", "withdrawn"], approved: [], rejected: [], withdrawn: [],
  },
} as const;

export type StateMachineName = keyof typeof transitions;
export type StateTransitionContext = {
  reason?: string;
  completedChecklist?: boolean;
  requiredChecklist?: boolean;
  proofProvided?: boolean;
  proofRequired?: boolean;
};

export function assertTransition(machine: StateMachineName, from: string, to: string, context: StateTransitionContext = {}): void {
  const graph = transitions[machine] as Record<string, readonly string[]>;
  if (!graph[from]?.includes(to)) throw new DomainError("INVALID_TRANSITION", `Cannot move ${machine} from ${from} to ${to}.`, 409);
  if (machine === "job" && to === "completed") {
    if (context.requiredChecklist && !context.completedChecklist) throw new DomainError("VALIDATION_ERROR", "Complete the required checklist first.", 422);
    if (context.proofRequired && !context.proofProvided) throw new DomainError("VALIDATION_ERROR", "Add completion proof first.", 422);
  }
  if (machine === "job" && ["skipped", "missed", "canceled"].includes(to) && !context.reason?.trim()) {
    throw new DomainError("VALIDATION_ERROR", "A reason is required.", 422);
  }
}

export function allowedTransitions(machine: StateMachineName, from: string): readonly string[] {
  return (transitions[machine] as Record<string, readonly string[]>)[from] ?? [];
}
