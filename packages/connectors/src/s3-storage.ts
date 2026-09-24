import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ConnectorDefinition } from "./registry.ts";
import { ConnectorError, type StorageCapability } from "./types.ts";

export type S3StorageConfig = Readonly<{
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  signingSecret?: string;
  now?: () => Date;
  requestHandler?: S3ClientConfig["requestHandler"];
}>;

const MAX_LINK_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const safeProviderError = () => new ConnectorError("provider_error", "File storage is temporarily unavailable.", true);
const safeInvalid = (message: string) => new ConnectorError("invalid_request", message, false);

function validateConfig(config: S3StorageConfig): URL {
  let endpoint: URL;
  try { endpoint = new URL(config.endpoint); } catch { throw new Error("S3 endpoint must be a valid URL"); }
  const localHttp = endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if ((!localHttp && endpoint.protocol !== "https:") || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("S3 endpoint must use HTTPS and cannot include credentials, query, or fragment");
  }
  if (!config.bucket.trim() || config.bucket.includes("/") || !config.region.trim()
    || !config.accessKeyId.trim() || !config.secretAccessKey.trim()) throw new Error("S3 storage configuration is incomplete");
  return endpoint;
}

function validateObjectKey(key: string): void {
  if (typeof key !== "string" || !key.trim() || key.length > 1024 || key.startsWith("/") || key.endsWith("/")
    || key.includes("\\") || /[\u0000-\u001f\u007f]/.test(key)
    || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw safeInvalid("Invalid file key.");
  }
}

function validateContentType(contentType: string): void {
  if (typeof contentType !== "string" || contentType.length > 255
    || !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+(?:\s*;\s*[\w!#$&^_.+-]+=(?:[\w!#$&^_.+-]+|"[^"\r\n]*"))*$/.test(contentType)) {
    throw safeInvalid("A valid content type is required.");
  }
}

function expiresAtDate(value: string, now: Date): Date {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= now.getTime()) throw safeInvalid("Expiration must be in the future.");
  if (timestamp - now.getTime() > MAX_LINK_LIFETIME_SECONDS * 1000) throw safeInvalid("File links can expire within seven days.");
  return new Date(timestamp);
}

function isMissingObject(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate?.name === "NoSuchKey" || candidate?.name === "NotFound" || candidate?.$metadata?.httpStatusCode === 404;
}

/**
 * Creates an infrastructure-configured S3-compatible storage adapter. Configuration is
 * server-owned; this connector deliberately does not expose bucket credentials in tenant setup.
 */
export function createS3StorageDefinition(config: S3StorageConfig): ConnectorDefinition {
  const endpoint = validateConfig(config);
  const now = config.now ?? (() => new Date());
  const signingSecret = config.signingSecret ?? randomBytes(32).toString("hex");
  const client = new S3Client({
    endpoint: endpoint.toString(),
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: config.forcePathStyle ?? true,
    ...(config.requestHandler ? { requestHandler: config.requestHandler } : {}),
  });

  return {
    manifest: {
      key: "s3-compatible",
      name: "S3-compatible file storage",
      description: "Store protected business files using the server’s configured file storage.",
      provider: "S3-compatible storage",
      icon: "folder",
      categories: ["files"],
      capabilities: ["storage"],
      authType: "service_account",
      requiredScopes: [],
      environments: ["local", "test", "production"],
      setupComplexity: "easy",
      discoverableResources: [],
      webhookSupport: false,
      syncModes: [],
      version: "1.0.0",
      availability: "credentials_ready",
      platformManaged: true,
    },
    createConfiguredScope({ tenantId, ensureAvailable }) {
      if (!tenantId.trim()) throw new Error("Tenant ID is required");
      const tenantPrefix = `tenants/${createHash("sha256").update(tenantId).digest("hex")}/`;
      const issuedLinks = new Map<string, { key: string; expiresAt: number }>();
      const linkToken = (link: string) => createHmac("sha256", signingSecret).update(`${tenantPrefix}\0${link}`).digest("hex");
      const storage: StorageCapability = {
        async putObject(input) {
          ensureAvailable();
          validateObjectKey(input.key);
          validateContentType(input.contentType);
          if (!(input.content instanceof Uint8Array)) throw safeInvalid("File contents must be bytes.");
          try {
            await client.send(new PutObjectCommand({
              Bucket: config.bucket,
              Key: `${tenantPrefix}${input.key}`,
              Body: input.content,
              ContentType: input.contentType,
            }));
            return { key: input.key, size: input.content.byteLength };
          } catch { throw safeProviderError(); }
        },
        async getObject(key) {
          ensureAvailable();
          validateObjectKey(key);
          try {
            const output = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: `${tenantPrefix}${key}` }));
            if (!output.Body) return undefined;
            const content = await output.Body.transformToByteArray();
            return { content: new Uint8Array(content), contentType: output.ContentType ?? "application/octet-stream" };
          } catch (error) {
            if (isMissingObject(error)) return undefined;
            throw safeProviderError();
          }
        },
        async deleteObject(key) {
          ensureAvailable();
          validateObjectKey(key);
          try {
            await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: `${tenantPrefix}${key}` }));
          } catch { throw safeProviderError(); }
        },
        async createDownloadLink(key, expiresAt) {
          ensureAvailable();
          validateObjectKey(key);
          const expiry = expiresAtDate(expiresAt, now());
          try {
            await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: `${tenantPrefix}${key}` }));
          } catch (error) {
            if (isMissingObject(error)) throw safeInvalid("File was not found.");
            throw safeProviderError();
          }
          try {
            for (const [token, issued] of issuedLinks) if (issued.expiresAt <= now().getTime()) issuedLinks.delete(token);
            const link = await getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: `${tenantPrefix}${key}` }), {
              expiresIn: Math.max(1, Math.floor((expiry.getTime() - now().getTime()) / 1000)),
            });
            issuedLinks.set(linkToken(link), { key, expiresAt: expiry.getTime() });
            return link;
          } catch { throw safeProviderError(); }
        },
        async getObjectByDownloadLink(link) {
          ensureAvailable();
          const issued = typeof link === "string" ? issuedLinks.get(linkToken(link)) : undefined;
          if (!issued || issued.expiresAt <= now().getTime()) throw safeInvalid("File link is invalid or expired.");
          return storage.getObject(issued.key);
        },
      };
      return { storage };
    },
  };
}
