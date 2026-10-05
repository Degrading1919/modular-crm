const mode = process.argv[2];
if (!["live", "ready"].includes(mode)) process.exit(1);
const port = process.argv[3] === "worker" ? process.env.WORKER_HEALTH_PORT || "3001" : process.env.PORT || "3000";
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health/${mode}`, { signal: AbortSignal.timeout(2_000) });
  process.exit(response.status === 200 ? 0 : 1);
} catch { process.exit(1); }
