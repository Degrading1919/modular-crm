import { allowedTransitions } from "@modular-crm/domain";
import { ApiError, friendly } from "./api";

export type OfflineOperation = {
  id: string;
  path: string;
  entityId?: string;
  expectedPriorState?: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status: "pending" | "conflict" | "failed";
  error?: { code?: string; status?: number; message: string; details?: unknown };
};
export const queueKey = (userId: string, tenantId: string) => `modular-field-queue-v2:${tenantId}:${userId}`;

export function readQueue(userId: string, tenantId: string): OfflineOperation[] {
  if (!userId || !tenantId || typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(queueKey(userId, tenantId)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is OfflineOperation => Boolean(item && typeof item.id === "string" && typeof item.path === "string" && item.payload && typeof item.payload === "object")) : [];
  } catch { return []; }
}

export function saveQueue(userId: string, tenantId: string, items: OfflineOperation[]) {
  if (!userId || !tenantId || typeof localStorage === "undefined") return false;
  try {
    const key = queueKey(userId, tenantId);
    if (items.length) localStorage.setItem(key, JSON.stringify(items));
    else localStorage.removeItem(key);
    return true;
  } catch { return false; }
}

// Job notes/proof and transitions share an ordering key. Time actions, including
// mileage (which requires an open shift), share another. New tickets are independent.
export function dependencyKey(operation: OfflineOperation): string {
  const parts = operation.path.split("/");
  const jobId = parts[parts.indexOf("jobs") + 1];
  if (parts.includes("jobs") && jobId) return `job:${jobId}`;
  if (operation.path === "/field/time") return "shift";
  return `operation:${operation.id}`;
}

export function blockedBy(queue: OfflineOperation[], operation: OfflineOperation) {
  return queue.slice(0, queue.findIndex((item) => item.id === operation.id))
    .find((item) => dependencyKey(item) === dependencyKey(operation));
}

export function discardGroup(queue: OfflineOperation[], id: string): OfflineOperation[] {
  const index = queue.findIndex((item) => item.id === id);
  if (index < 0) return [];
  return queue.slice(index).filter((item) => dependencyKey(item) === dependencyKey(queue[index]!));
}

export function errorRecord(issue: unknown): NonNullable<OfflineOperation["error"]> {
  if (issue instanceof ApiError) return { code: issue.code, status: issue.status, message: issue.message, details: issue.details };
  return { message: issue instanceof Error ? issue.message : "Could not sync this update." };
}

export function fieldErrorText(issue: OfflineOperation["error"]) {
  if (!issue) return "This update is waiting to sync.";
  if (issue.code === "CONFLICT") {
    const details = issue.details && typeof issue.details === "object" ? issue.details as Record<string, unknown> : {};
    const expected = details.expectedState ?? details.expectedPriorState;
    const current = details.currentState ?? details.current;
    return `The job changed. Review it with your office before retrying.${expected ? ` Expected state: ${friendly(String(expected))}.` : ""}${current ? ` Current state: ${friendly(String(current))}.` : ""} Your evidence is still saved on this device.`;
  }
  if (issue.code === "IDEMPOTENCY_CONFLICT") return "This update does not match the version already received. Keep its evidence and contact your office; do not change the saved update before retrying.";
  if (issue.code === "INVALID_TRANSITION") return "This action is not available for the job’s current status. Open the current job and review this saved update with your office.";
  if (issue.status === 401) return "Sign in again to sync. Your updates remain saved on this device.";
  if (issue.status === 403 || issue.status === 404) return "You no longer have access to this work. Check with your office. Your evidence remains saved on this device.";
  if (!issue.status || issue.status >= 500) return "Could not connect to save this update. It remains on this device; try syncing again when connected.";
  return issue.message;
}

// Serialize enqueue, sync, retry and discard in this page and across tabs. Always
// reread persisted state under the lock; no stale snapshot may overwrite new work.
const locks = new Map<string, Promise<unknown>>();
export function withQueueLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => typeof navigator !== "undefined" && navigator.locks
    ? await navigator.locks.request(key, task) : await task();
  const result = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
  locks.set(key, result);
  void result.finally(() => { if (locks.get(key) === result) locks.delete(key); }).catch(() => {});
  return result;
}

export async function drainQueue(store: { read: () => OfflineOperation[]; write: (items: OfflineOperation[]) => void }, send: (operation: OfflineOperation) => Promise<unknown>) {
  const attempted = new Set<string>();
  for (;;) {
    const queue = store.read();
    const operation = queue.find((item) => item.status === "pending" && !attempted.has(item.id) && !blockedBy(queue, item));
    if (!operation) return;
    attempted.add(operation.id);
    try {
      await send(operation);
    } catch (issue) {
      const error = errorRecord(issue);
      const conflict = error.code === "CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT";
      const transient = !(issue instanceof ApiError) || [408, 425, 429].includes(issue.status) || issue.status >= 500;
      store.write(store.read().map((item) => item.id === operation.id ? { ...item, status: conflict ? "conflict" : transient ? "pending" : "failed", error } : item));
      continue;
    }
    // Persistence failure is not an API failure; stop and retain the original ID
    // for an idempotent replay, never continue dependent work without its receipt.
    store.write(store.read().filter((item) => item.id !== operation.id));
  }
}

export function projectedJobState(serverState: string, jobId: string, queue: OfflineOperation[]): string {
  let state = serverState;
  for (const item of queue.filter((operation) => dependencyKey(operation) === `job:${jobId}`)) {
    if (item.status !== "pending") break;
    const next = item.path.endsWith("/complete") ? "completed" : item.path.endsWith("/skip") ? "skipped" : item.path.endsWith("/transition") ? item.payload.status : undefined;
    if (typeof next !== "string") continue;
    if (next === state) continue; // Lost response: the server already accepted this operation.
    if (item.expectedPriorState !== state || !allowedTransitions("job", state).includes(next)) break;
    state = next;
  }
  return state;
}

export function fieldActions(state: string, permissions: readonly string[]) {
  const required: Record<string, string> = { en_route: "jobs.start", in_progress: "jobs.start", paused: "jobs.start", completed: "jobs.complete", skipped: "jobs.skip" };
  return allowedTransitions("job", state).filter((next) => required[next] && permissions.includes(required[next]!));
}

export function projectedShiftState(serverState: string, queue: OfflineOperation[]): string {
  let state = serverState;
  for (const item of queue.filter((operation) => dependencyKey(operation) === "shift")) {
    if (item.status !== "pending") break;
    const action = item.payload.action;
    if (action === "mileage") continue; // Ordered with the shift, but does not change its status.
    if (action === "clock_in") state = "clocked_in";
    else if (action === "clock_out") state = "clocked_out";
    else if (action === "break_start" && ["clocked_in", "on_break"].includes(state)) state = "on_break";
    else if (action === "break_end" && ["clocked_in", "on_break"].includes(state)) state = "clocked_in";
    else break;
  }
  return state;
}
