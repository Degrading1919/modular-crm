import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const defaultDataDirectory = fileURLToPath(new URL("../../../.local-data/pglite/", import.meta.url));
const dataDirectory = process.env.PGLITE_DATA_DIR === ":memory:"
  ? ":memory:"
  : resolve(process.env.PGLITE_DATA_DIR || defaultDataDirectory);
const port = Number(process.env.PGLITE_PORT || 5433);
const maxConnections = Number(process.env.PGLITE_MAX_CONNECTIONS || 40);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PGLITE_PORT must be a valid TCP port.");
if (!Number.isInteger(maxConnections) || maxConnections < 1) throw new Error("PGLITE_MAX_CONNECTIONS must be positive.");
if (dataDirectory !== ":memory:") await mkdir(dirname(dataDirectory), { recursive: true });

const embeddedDatabase = await PGlite.create(dataDirectory === ":memory:" ? undefined : dataDirectory);
const server = new PGLiteSocketServer({
  db: embeddedDatabase,
  host: "127.0.0.1",
  port,
  maxConnections,
});

try {
  await server.start();
  console.info(`Local PGlite is ready at postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);
  console.info(`Data directory: ${dataDirectory}`);
} catch (error) {
  await embeddedDatabase.close();
  throw error;
}

let closing = false;
async function close(exitCode = 0) {
  if (closing) return;
  closing = true;
  await server.stop();
  await embeddedDatabase.close();
  process.exit(exitCode);
}
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });

// pglite-socket 0.2.11 can surface a client disconnect as an unhandled socket
// ECONNRESET. Keep the local server alive so other clients can reconnect.
process.on("uncaughtException", (error: NodeJS.ErrnoException) => {
  if (error.code === "ECONNRESET") {
    console.warn("A local database client disconnected; the socket server remains available.");
    return;
  }
  console.error(error);
  void close(1);
});
