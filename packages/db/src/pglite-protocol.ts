import type { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PGlite } from "@electric-sql/pglite";

type Query = { handlerId: number; message: Uint8Array; onData: (data: Uint8Array) => void; resolve: (size: number) => void; reject: (error: Error) => void };

/**
 * The pinned socket adapter queues individual wire messages, but PGlite has one
 * backend session. Another Parse can replace an auth query before its Bind, or
 * another Execute can use its portal. Own the backend through ReadyForQuery(I),
 * not through one packet. A transaction keeps ownership through commit/rollback.
 * This is a local emulator guard; it never changes production PostgreSQL pools.
 */
class ProtocolQueue {
  private pending: Query[] = [];
  private owner: number | null = null;
  private processing?: Promise<void>;
  private disconnected = new Set<number>();
  private response = Buffer.alloc(0);
  constructor(private db: PGlite) {}

  enqueue(handlerId: number, message: Uint8Array, onData: Query["onData"]): Promise<number> {
    if (this.disconnected.has(handlerId) || this.db.closed) return Promise.reject(new Error("Handler disconnected"));
    return new Promise((resolve, reject) => {
      this.pending.push({ handlerId, message, onData, resolve, reject });
      this.start();
    });
  }
  getQueueLength() { return this.pending.length; }
  private start() {
    if (this.processing) return;
    this.processing = this.pump().finally(() => {
      this.processing = undefined;
      // The handler can enqueue its next packet as the previous promise resolves.
      if (this.pending.some((query) => this.owner === null || query.handlerId === this.owner)) this.start();
    });
  }
  private async pump() {
    while (this.pending.length && !this.db.closed) {
      const index = this.owner === null ? 0 : this.pending.findIndex((query) => query.handlerId === this.owner);
      if (index < 0) return;
      const query = this.pending.splice(index, 1)[0]!;
      this.owner = query.handlerId;
      let size = 0, idle = false;
      try {
        await this.db.runExclusive(async () => this.db.execProtocolRawStream(query.message, { onRawData: (data) => {
          size += data.length;
          this.response = Buffer.concat([this.response, data]);
          while (this.response.length >= 5 && this.response.length >= this.response.readInt32BE(1) + 1) {
            const length = this.response.readInt32BE(1) + 1;
            if (this.response[0] === 90) idle = this.response[5] === 73; // ReadyForQuery: Idle, not T/E.
            this.response = this.response.subarray(length);
          }
          query.onData(data);
        } }));
        if (idle) this.owner = null;
        query.resolve(size);
      } catch (error) { query.reject(error instanceof Error ? error : new Error("Local database protocol failed")); }
    }
  }
  clearQueueForHandler(handlerId: number) {
    this.disconnected.add(handlerId);
    this.pending = this.pending.filter((query) => {
      if (query.handlerId !== handlerId) return true;
      query.reject(new Error("Handler disconnected")); return false;
    });
  }
  async clearTransactionIfNeeded(handlerId: number) {
    // Detach may race a packet already in flight. Do not roll back somebody
    // else's work or close the database before that packet has finished.
    await this.processing;
    if (this.owner !== handlerId || this.db.closed) return;
    await this.db.runExclusive(async () => {
      // Sync also clears the extended-protocol error/discard state.
      await this.db.execProtocolRawStream(new Uint8Array([83, 0, 0, 0, 4]), { onRawData: () => {} });
      if (this.db.isInTransaction()) {
        // Use the raw protocol inside runExclusive, not exec() (which takes the
        // same mutex again). Rollback must finish before another client runs.
        const query = Buffer.from("ROLLBACK\0");
        const header = Buffer.alloc(5); header[0] = 81; header.writeInt32BE(query.length + 4, 1);
        await this.db.execProtocolRawStream(Buffer.concat([header, query]), { onRawData: () => {} });
      }
    });
    this.response = Buffer.alloc(0); this.owner = null;
    this.start();
  }
  async settled() { await this.processing; }
}

/** Install before server.start(), while no socket handlers exist. Version pinned in package.json. */
export function isolatePgliteProtocol(server: PGLiteSocketServer): { settled: () => Promise<void> } {
  const internals = server as unknown as { queryQueue?: unknown; handlers?: Set<unknown> };
  if (!internals.queryQueue || internals.handlers?.size !== 0) throw new Error("Unsupported or already active PGlite socket adapter.");
  const queue = new ProtocolQueue(server.db);
  internals.queryQueue = queue;
  return queue;
}
