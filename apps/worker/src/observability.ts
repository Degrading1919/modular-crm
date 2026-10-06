import { logJson, reportFailure, requestId, withRequestContext } from "@modular-crm/config/observability";

export async function observeJob<T>(route: string, data: unknown, work: () => Promise<T>): Promise<T> {
  const job = data && typeof data === "object" ? data as { requestId?: string; tenantId?: string } : {};
  return withRequestContext({ requestId: requestId(job.requestId), route, tenantId: job.tenantId }, async () => {
    const started = performance.now();
    try {
      const result = await work();
      // A scheduled automation delay also returns "retry"; it is not a failure.
      const failed = result === "failed" || (route === "mcrm.webhook-delivery" && result === "retry");
      if (failed) await reportFailure(undefined, { errorCode: "worker_job_failed", status: 500, durationMs: performance.now() - started });
      logJson(failed ? "error" : "info", "job.completed", { status: failed ? 500 : 200, durationMs: performance.now() - started, component: "worker" });
      return result;
    } catch (error) {
      await reportFailure(error, { errorCode: "worker_job_failed", status: 500, durationMs: performance.now() - started });
      logJson("error", "job.failed", { status: 500, durationMs: performance.now() - started, component: "worker" });
      throw error;
    }
  });
}
