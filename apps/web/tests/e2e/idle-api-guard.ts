import { expect, type Page, type Request } from "@playwright/test";

/** Count browser GETs by API path, including changes to query parameters. */
export function trackApiGets(page: Page) {
  const counts = new Map<string, number>();
  const record = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path.startsWith("/api/v1/")) counts.set(path, (counts.get(path) ?? 0) + 1);
  };
  page.on("request", record);
  return { counts, stop: () => page.off("request", record) };
}

/** A measured idle window, not a delay to help a flaky action eventually pass. */
export async function expectBoundedIdleApiGets(page: Page, maxPerPath = 3, milliseconds = 3_000) {
  const tracker = trackApiGets(page);
  try {
    // Use the test runner's real clock: field/date specs may mock the browser clock.
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    const excess = [...tracker.counts].filter(([, count]) => count > maxPerPath);
    console.info(`Idle API GETs (${milliseconds}ms, limit ${maxPerPath}): ${JSON.stringify(Object.fromEntries(tracker.counts))}`);
    expect(excess, "API GET paths must not refetch repeatedly while the screen is idle").toEqual([]);
    return tracker.counts;
  } finally { tracker.stop(); }
}
