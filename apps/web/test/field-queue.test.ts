import { describe, expect, it } from "vitest";
import { allowedTransitions } from "@modular-crm/domain";
import { ApiError } from "../components/api";
import { blockedBy, discardGroup, drainQueue, fieldActions, fieldErrorText, projectedJobState, projectedShiftState, withQueueLock, type OfflineOperation } from "../components/field-queue";

const operation = (id: string, job = "one", next = "in_progress", from = "dispatched"): OfflineOperation => ({
  id, path: `/jobs/${job}/transition`, entityId: job, expectedPriorState: from, payload: { status: next, expectedPriorState: from }, createdAt: "2026-10-04T12:00:00Z", status: "pending",
});
function store(items: OfflineOperation[]) {
  let queue = items;
  return { read: () => queue, write: (next: OfflineOperation[]) => { queue = next; } };
}

describe("field action and causal queue contract", () => {
  it("offers only canonical transitions intersected with granted permissions for every job state", () => {
    for (const state of ["draft", "unscheduled", "scheduled", "dispatched", "en_route", "in_progress", "paused", "completed", "skipped", "missed", "canceled", "needs_return", "unknown"]) {
      const actions = fieldActions(state, ["jobs.start", "jobs.complete", "jobs.skip"]);
      expect(actions.every((next) => allowedTransitions("job", state).includes(next))).toBe(true);
      expect(fieldActions(state, [])).toEqual([]);
    }
    expect(fieldActions("scheduled", ["jobs.start", "jobs.skip"])).toEqual(["skipped"]);
    expect(fieldActions("paused", ["jobs.start"])).toEqual(["in_progress"]);
    expect(fieldActions("in_progress", ["jobs.complete"])).toEqual(["completed"]);
  });

  it("drains consecutive successful updates without skipping the shifted array entry", async () => {
    const queue = store([operation("start"), operation("pause", "one", "paused", "in_progress"), operation("resume", "one", "in_progress", "paused")]);
    const sent: string[] = [];
    await drainQueue(queue, async (item) => { sent.push(item.id); });
    expect(sent).toEqual(["start", "pause", "resume"]);
    expect(queue.read()).toEqual([]);
  });

  it.each([409, 422, 503])("a %i failure holds same-job dependents but drains unrelated work serially", async (status) => {
    const queue = store([operation("a"), operation("dependent", "one", "paused", "in_progress"), operation("b", "two"), operation("c", "three")]);
    const sent: string[] = [];
    let inFlight = 0;
    await drainQueue(queue, async (item) => {
      expect(++inFlight).toBe(1);
      sent.push(item.id);
      await Promise.resolve();
      inFlight--;
      if (item.id === "a") throw new ApiError("failure", status, status === 409 ? "CONFLICT" : "VALIDATION_ERROR");
    });
    expect(sent).toEqual(["a", "b", "c"]);
    expect(queue.read().map((item) => item.id)).toEqual(["a", "dependent"]);
    expect(blockedBy(queue.read(), queue.read()[1]!)?.id).toBe("a");
  });

  it("does not automatically retry unresolved work, and deliberate retry releases dependencies with the same identity", async () => {
    const first = { ...operation("a"), status: "conflict" as const, error: { message: "changed" } };
    const queue = store([first, operation("dependent", "one", "paused", "in_progress"), operation("b", "two")]);
    const sent: OfflineOperation[] = [];
    await drainQueue(queue, async (item) => { sent.push(item); });
    expect(sent.map((item) => item.id)).toEqual(["b"]);
    queue.write(queue.read().map((item) => item.id === "a" ? { ...item, status: "pending", error: undefined } : item));
    await drainQueue(queue, async (item) => { sent.push(item); });
    expect(sent.map((item) => item.id)).toEqual(["b", "a", "dependent"]);
    expect(sent[1]).toMatchObject({ id: first.id, createdAt: first.createdAt, payload: first.payload });
    expect(queue.read()).toEqual([]);
  });

  it("keeps shift ordering without blocking mileage or ticket drafts", async () => {
    const time = (id: string, action: string) => ({ ...operation(id), entityId: undefined, path: "/field/time", payload: { action } });
    const queue = store([time("in", "clock_in"), time("out", "clock_out"), time("miles", "mileage"), { ...operation("ticket"), path: "/field/tickets", entityId: undefined }]);
    const sent: string[] = [];
    await drainQueue(queue, async (item) => { sent.push(item.id); if (item.id === "in") throw new ApiError("denied", 403); });
    expect(sent).toEqual(["in", "miles", "ticket"]);
    expect(queue.read().map((item) => item.id)).toEqual(["in", "out"]);
  });

  it("discard selects only the chosen operation and later same-work dependents, preserving unrelated evidence", () => {
    const queue = [operation("earlier"), operation("chosen"), operation("other", "two"), operation("dependent", "one", "paused", "in_progress")];
    expect(discardGroup(queue, "chosen").map((item) => item.id)).toEqual(["chosen", "dependent"]);
    expect(discardGroup(queue, "absent")).toEqual([]);
    expect(queue[2]!.payload).toEqual({ status: "in_progress", expectedPriorState: "dispatched" });
  });

  it("projects legal offline action chains, including a lost server response, but stops at unresolved or stale work", () => {
    const queue = [operation("way", "one", "en_route"), operation("start", "one", "in_progress", "en_route"), operation("pause", "one", "paused", "in_progress")];
    expect(projectedJobState("dispatched", "one", queue)).toBe("paused");
    expect(projectedJobState("en_route", "one", queue)).toBe("paused");
    expect(projectedJobState("canceled", "one", queue)).toBe("canceled");
    expect(projectedJobState("dispatched", "one", [{ ...queue[0]!, status: "conflict" }, ...queue.slice(1)])).toBe("dispatched");
  });

  it("serializes overlapping sync/enqueue/discard requests and releases the lock after failure", async () => {
    const events: string[] = [];
    await Promise.allSettled([
      withQueueLock("identity", async () => { events.push("sync"); await Promise.resolve(); events.push("end"); throw new Error("offline"); }),
      withQueueLock("identity", async () => { events.push("enqueue"); }),
      withQueueLock("identity", async () => { events.push("discard"); }),
    ]);
    expect(events).toEqual(["sync", "end", "enqueue", "discard"]);
  });

  it("projects an offline shift and break chain so dependent actions can be recorded in order", () => {
    const queue = ["clock_in", "break_start", "break_end", "clock_out"].map((action) => ({ ...operation(action), path: "/field/time", entityId: undefined, payload: { action } }));
    expect(projectedShiftState("clocked_out", queue.slice(0, 1))).toBe("clocked_in");
    expect(projectedShiftState("clocked_out", queue.slice(0, 2))).toBe("on_break");
    expect(projectedShiftState("clocked_out", queue.slice(0, 3))).toBe("clocked_in");
    expect(projectedShiftState("clocked_out", queue)).toBe("clocked_out");
    expect(projectedShiftState("clocked_out", [{ ...queue[0]!, status: "failed" }, ...queue.slice(1)])).toBe("clocked_out");
  });

  it("stops on local persistence failure without sending dependent work or replacing the operation identity", async () => {
    const items = [operation("accepted"), operation("dependent", "one", "paused", "in_progress")];
    const sent: string[] = [];
    await expect(drainQueue({ read: () => items, write: () => { throw new Error("storage full"); } }, async (item) => { sent.push(item.id); })).rejects.toThrow("storage full");
    expect(sent).toEqual(["accepted"]);
    expect(items[0]!.id).toBe("accepted");
  });

  it("presents actionable field feedback without leaking internal transition or transport errors", () => {
    expect(fieldErrorText({ code: "INVALID_TRANSITION", message: "Cannot move job from scheduled to in_progress" })).not.toContain("Cannot move");
    expect(fieldErrorText({ status: 500, message: "SQL portal failure" })).not.toContain("SQL");
    expect(fieldErrorText({ code: "IDEMPOTENCY_CONFLICT", message: "internal" })).not.toContain("unknown");
    expect(fieldErrorText({ code: "CONFLICT", message: "internal", details: { expectedPriorState: "in_progress", currentState: "canceled" } })).toContain("Current state: Canceled");
  });
});
