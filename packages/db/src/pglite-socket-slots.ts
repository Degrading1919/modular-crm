import type { Server } from "node:net";
import type { PGLiteSocketServer } from "@electric-sql/pglite-socket";

type SocketServerInternals = { server?: Server; handlers?: Set<{ isAttached: boolean }> };

/**
 * pglite-socket 0.2.11 releases a connection slot only when a client closes cleanly. A client that
 * disconnects with a socket error (a killed dev server, worker, or test run) keeps its slot forever,
 * so after enough restarts the local database rejects new connections. Before each new connection
 * is admitted, drop the slots whose socket is already gone. Call after `server.start()`.
 */
export function releaseDisconnectedSlots(server: PGLiteSocketServer): void {
  const internals = server as unknown as SocketServerInternals;
  if (!internals.server || !internals.handlers) throw new Error("Unsupported pglite-socket version: connection slots are not accessible.");
  const handlers = internals.handlers;
  internals.server.on("connection", () => {
    for (const handler of handlers) if (!handler.isAttached) handlers.delete(handler);
  });
}
