import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { ConnectorDefinition } from "./registry.ts";
import { ConnectorError, type StorageCapability } from "./types.ts";

export type LocalStorageOptions = Readonly<{
  rootDirectory: string;
  signingSecret?: string;
  now?: () => Date;
}>;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const requiredKey = (key: string) => { if (!key.trim() || key.includes("..") || key.includes("\\") || key.startsWith("/")) throw new ConnectorError("invalid_request", "Invalid object key", false); };
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** Durable server-side storage for no-Docker local development and owner playtesting. */
export function createLocalStorageDefinition(options: LocalStorageOptions): ConnectorDefinition {
  const rootDirectory = resolve(options.rootDirectory);
  if (!isAbsolute(rootDirectory)) throw new Error("Storage root must resolve to an absolute path");
  const signingSecret = options.signingSecret ?? randomBytes(32).toString("hex");
  const now = options.now ?? (() => new Date());
  return {
    manifest: {
      key: "local-storage",
      name: "Local files",
      description: "Store protected business files on this server for local development.",
      provider: "Modular CRM Local",
      icon: "folder",
      categories: ["files"],
      capabilities: ["storage"],
      authType: "local_mock",
      requiredScopes: [],
      environments: ["local", "test"],
      setupComplexity: "easy",
      discoverableResources: [],
      webhookSupport: false,
      syncModes: [],
      version: "1.0.0",
      availability: "local_ready",
    },
    createScope({ tenantId, ensureAvailable }) {
      const tenantHash = hash(tenantId);
      const tenantDirectory = join(rootDirectory, tenantHash);
      const paths = (key: string) => {
        requiredKey(key);
        const objectHash = hash(key);
        return { data: join(tenantDirectory, `${objectHash}.bin`), metadata: join(tenantDirectory, `${objectHash}.json`) };
      };
      const sign = (key: string, expiresAt: string) => createHmac("sha256", signingSecret).update(`${tenantHash}\0${key}\0${expiresAt}`).digest("hex");
      const storage: StorageCapability = {
        async putObject(input) {
          ensureAvailable();
          const path = paths(input.key);
          if (!input.contentType.trim()) throw new ConnectorError("invalid_request", "Content type is required", false);
          await mkdir(tenantDirectory, { recursive: true });
          const nonce = randomBytes(8).toString("hex");
          const tempData = `${path.data}.${nonce}.tmp`;
          const tempMetadata = `${path.metadata}.${nonce}.tmp`;
          try {
            await writeFile(tempData, input.content);
            await writeFile(tempMetadata, JSON.stringify({ key: input.key, contentType: input.contentType }));
            await rename(tempData, path.data);
            await rename(tempMetadata, path.metadata);
            return { key: input.key, size: input.content.length };
          } finally {
            await Promise.all([rm(tempData, { force: true }), rm(tempMetadata, { force: true })]);
          }
        },
        async getObject(key) {
          ensureAvailable();
          const path = paths(key);
          try {
            const [content, rawMetadata] = await Promise.all([readFile(path.data), readFile(path.metadata, "utf8")]);
            const metadata = JSON.parse(rawMetadata) as { key: string; contentType: string };
            if (metadata.key !== key) throw new ConnectorError("provider_error", "Stored file metadata mismatch", false);
            return { content: new Uint8Array(content), contentType: metadata.contentType };
          } catch (error) {
            if (isMissing(error)) return undefined;
            throw error;
          }
        },
        async deleteObject(key) {
          ensureAvailable();
          const path = paths(key);
          await Promise.all([rm(path.data, { force: true }), rm(path.metadata, { force: true })]);
        },
        async createDownloadLink(key, expiresAt) {
          ensureAvailable();
          requiredKey(key);
          if (!(await storage.getObject(key))) throw new ConnectorError("invalid_request", "Object was not found", false);
          const expiry = new Date(expiresAt).getTime();
          if (!Number.isFinite(expiry) || expiry <= now().getTime()) throw new ConnectorError("invalid_request", "Expiration must be in the future", false);
          const url = new URL("local-storage://download");
          url.searchParams.set("tenant", tenantHash);
          url.searchParams.set("key", Buffer.from(key).toString("base64url"));
          url.searchParams.set("expires", expiresAt);
          url.searchParams.set("signature", sign(key, expiresAt));
          return url.toString();
        },
        async getObjectByDownloadLink(link) {
          ensureAvailable();
          let url: URL;
          try { url = new URL(link); } catch { throw new ConnectorError("invalid_request", "Invalid file link", false); }
          const key = Buffer.from(url.searchParams.get("key") ?? "", "base64url").toString("utf8");
          const expiresAt = url.searchParams.get("expires") ?? "";
          const suppliedSignature = url.searchParams.get("signature") ?? "";
          const expected = sign(key, expiresAt);
          if (url.protocol !== "local-storage:" || url.hostname !== "download" || url.searchParams.get("tenant") !== tenantHash || !/^[0-9a-f]{64}$/.test(suppliedSignature) || !timingSafeEqual(Buffer.from(suppliedSignature, "hex"), Buffer.from(expected, "hex")) || new Date(expiresAt).getTime() <= now().getTime()) throw new ConnectorError("invalid_request", "File link is invalid or expired", false);
          return storage.getObject(key);
        },
      };
      return { storage };
    },
  };
}
