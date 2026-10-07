/** Portable server config. Credential resolution stays inside the storage adapter. */
export function readObjectStorageConfig(env: Record<string, string | undefined>) {
  const keys = ["OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_ACCESS_KEY", "OBJECT_STORAGE_SECRET_KEY", "OBJECT_STORAGE_SESSION_TOKEN", "OBJECT_STORAGE_CREDENTIAL_MODE"];
  if (!keys.some((key) => env[key])) return undefined;
  const mode = env.OBJECT_STORAGE_CREDENTIAL_MODE ?? "static";
  if (!["static", "task-role"].includes(mode)) throw new Error("OBJECT_STORAGE_CREDENTIAL_MODE must be static or task-role");
  if (!env.OBJECT_STORAGE_ENDPOINT?.trim() || !env.OBJECT_STORAGE_BUCKET?.trim()
    || (mode === "static" && (!env.OBJECT_STORAGE_ACCESS_KEY?.trim() || !env.OBJECT_STORAGE_SECRET_KEY?.trim()))) throw new Error("Object storage configuration is incomplete");
  if (mode === "task-role" && (env.OBJECT_STORAGE_ACCESS_KEY || env.OBJECT_STORAGE_SECRET_KEY || env.OBJECT_STORAGE_SESSION_TOKEN)) throw new Error("Task-role storage must not include static credentials");
  return { endpoint: env.OBJECT_STORAGE_ENDPOINT, bucket: env.OBJECT_STORAGE_BUCKET, region: env.OBJECT_STORAGE_REGION ?? "us-east-1",
    credentialMode: mode as "static" | "task-role", accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY, secretAccessKey: env.OBJECT_STORAGE_SECRET_KEY,
    sessionToken: env.OBJECT_STORAGE_SESSION_TOKEN, forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE !== "false" };
}
