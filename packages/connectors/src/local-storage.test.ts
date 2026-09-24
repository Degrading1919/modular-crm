import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { ConnectorRegistry } from "./registry.ts";
import { createLocalStorageDefinition } from "./local-storage.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const absolute = resolve(directory);
    if (!absolute.startsWith(`${resolve(tmpdir())}${sep}`) || !absolute.includes("modular-crm-storage-")) throw new Error("Refusing to remove a test directory outside the dedicated temp root");
    await rm(absolute, { recursive: true, force: true });
  }
});

it("persists protected tenant files across registry restarts", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "modular-crm-storage-"));
  directories.push(rootDirectory);
  let currentTime = new Date("2026-09-23T12:00:00Z");
  const options = { rootDirectory, signingSecret: "test-only-signing-secret", now: () => currentTime };
  const first = new ConnectorRegistry(() => currentTime);
  first.register(createLocalStorageDefinition(options));
  first.connectLocal("tenant-a", "local-storage");
  const firstStorage = first.getCapability("tenant-a", "storage")!;
  await firstStorage.putObject({ key: "jobs/cleanup-proof.jpg", content: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
  const link = await firstStorage.createDownloadLink("jobs/cleanup-proof.jpg", "2026-09-23T13:00:00Z");
  const second = new ConnectorRegistry(() => currentTime);
  second.register(createLocalStorageDefinition(options));
  second.connectLocal("tenant-a", "local-storage");
  second.connectLocal("tenant-b", "local-storage");
  const secondStorage = second.getCapability("tenant-a", "storage")!;
  expect((await secondStorage.getObject("jobs/cleanup-proof.jpg"))?.content).toEqual(new Uint8Array([1, 2, 3]));
  expect((await secondStorage.getObjectByDownloadLink(link))?.contentType).toBe("image/jpeg");
  const otherTenant = second.getCapability("tenant-b", "storage")!;
  expect(await otherTenant.getObject("jobs/cleanup-proof.jpg")).toBeUndefined();
  await expect(otherTenant.getObjectByDownloadLink(link)).rejects.toMatchObject({ code: "invalid_request" });
  await expect(secondStorage.getObjectByDownloadLink(`${link}x`)).rejects.toMatchObject({ code: "invalid_request" });
  currentTime = new Date("2026-09-23T13:00:01Z");
  await expect(secondStorage.getObjectByDownloadLink(link)).rejects.toMatchObject({ code: "invalid_request" });
  await secondStorage.deleteObject("jobs/cleanup-proof.jpg");
  expect(await secondStorage.getObject("jobs/cleanup-proof.jpg")).toBeUndefined();
});
