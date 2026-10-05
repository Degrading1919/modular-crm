type Failure = { code?: string; message?: string };

/** Public copy only: machine status, codes and details remain untouched. */
export function userError(failure: Failure | undefined, status: number, path: string): string {
  const code = failure?.code;
  const authMessages: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: "The email address or password is incorrect. Please try again.",
    INVALID_PASSWORD: "The email address or password is incorrect. Please try again.",
    USER_NOT_FOUND: "The email address or password is incorrect. Please try again.",
    USER_ALREADY_EXISTS: "An account with this email address already exists. Sign in instead.",
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with this email address already exists. Sign in instead.",
    PASSWORD_TOO_SHORT: "Use a password with at least 8 characters.",
    PASSWORD_TOO_LONG: "This password is too long. Choose a shorter password.",
    INVALID_EMAIL: "Enter a valid email address.",
    EMAIL_NOT_VERIFIED: "Confirm your email address before signing in.",
  };
  if (path.includes("/auth/") && code && authMessages[code]) return authMessages[code]!;
  if (status === 401) return path.endsWith("/auth/login")
    ? "The email address or password is incorrect. Please try again." : "Please sign in again to continue.";
  if (code === "CAPABILITY_UNAVAILABLE") return "This tool isn’t enabled in your business setup. A business owner can enable it.";
  if (status === 403) return "You don’t have access to this action. Ask a business owner if you need access.";
  if (status === 404) return "This information is no longer available, or you don’t have access to it.";
  if (status === 429) return "Too many attempts. Please wait a few minutes and try again.";
  if (code === "INVALID_TRANSITION") return "This action is no longer available. Refresh to see the current options.";
  // Repository validation/conflict copy often contains useful recovery steps.
  // Do not forward provider internals or machine-oriented validation text.
  const message = failure?.message;
  const internal = /\b(HTTP|JSON|SQL|OAuth|endpoint|schema|database|query|exception|constraint|stack|idempotency|minor units|integer|undefined|null)\b|_[a-z]|Cannot move .* from /i;
  const repositoryCopy = ["VALIDATION_ERROR", "CONFLICT", "EXTERNAL_SERVICE_ERROR"].includes(code ?? "");
  const plainAvailabilityCopy = !code && /temporarily unavailable\.?$/i.test(message ?? "");
  if ((repositoryCopy || plainAvailabilityCopy) && message && !internal.test(message)) return plainAvailabilityCopy ? `${message} Please try again shortly.` : message;
  if (status >= 500) return "We couldn’t complete that action right now. Please try again shortly.";
  if (status === 409) return "This information has changed. Refresh and review it before trying again.";
  if (status === 400 || status === 422) return "Check the information you entered and try again.";
  if (status === 413) return "This update is too large. Try a smaller file or fewer items.";
  return "We couldn’t complete that action. Please try again.";
}
