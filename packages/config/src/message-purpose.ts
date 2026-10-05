export type MessagePurpose = "service" | "marketing" | "account";

/** Unknown automation is promotional; legacy transactional mail is a service notice. */
export function messagePurpose(value: unknown): MessagePurpose {
  return value === "service" || value === "transactional" ? "service" : value === "account" ? "account" : "marketing";
}

export const SERVICE_MESSAGE_KEYS = [
  "signup-confirmation", "cleanup-completed", "completion", "completion-thank-you", "job-completed",
  "service-day-reminder", "route-published", "appointment-reminder", "visit-reminder", "on-my-way",
  "estimate-sent", "invoice-sent", "invoice-due", "payment-receipt", "payment-failed",
] as const;
export const ACCOUNT_MESSAGE_KEYS = ["portal-invitation", "password-setup", "email-verification"] as const;

/** Upgrade only recognized built-ins, never infer purpose from an arbitrary trigger. */
export function builtInMessagePurpose(key: unknown): MessagePurpose {
  return typeof key === "string" && (SERVICE_MESSAGE_KEYS as readonly string[]).includes(key) ? "service"
    : typeof key === "string" && (ACCOUNT_MESSAGE_KEYS as readonly string[]).includes(key) ? "account" : "marketing";
}
