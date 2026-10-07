import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { describe, expect, it, vi } from "vitest";
import { createCloudFrontWebsiteProvider } from "./website-cloudfront.ts";
import { createWebsiteHosting } from "./website-hosting.ts";

const input = { id: "domain-id", hostname: "www.example.test" };
const tenant = { Id: "edge-id", Name: "crm-domain-domain-id", DistributionId: "distribution", ConnectionGroupId: "group", Domains: [{ Domain: input.hostname, Status: "active" }], Enabled: true, Status: "Deployed" };
function fixture(result = tenant, status = "issued") {
  const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => command.constructor.name === "GetManagedCertificateDetailsCommand"
    ? { ManagedCertificateDetails: { CertificateStatus: status } } : { DistributionTenant: result, ETag: "version" });
  return { send, provider: createCloudFrontWebsiteProvider("distribution", "group", "crm-staging", { send } as unknown as CloudFrontClient) };
}
describe("CloudFront customer certificates (SDK mocked; no AWS credentials)", () => {
  it("requires issued certificate, deployed tenant and active domain before serving", async () => {
    expect(await fixture().provider.ensure(input)).toEqual({ reference: "edge-id", state: "ready" });
    expect((await fixture({ ...tenant, Status: "InProgress" }).provider.ensure(input)).state).toBe("pending");
    expect((await fixture({ ...tenant, Domains: [{ Domain: input.hostname, Status: "inactive" }] }).provider.ensure(input)).state).toBe("pending");
    expect((await fixture(tenant, "pending-validation").provider.ensure(input)).state).toBe("pending");
    for (const status of ["expired", "validation-timed-out", "revoked", "failed", "inactive"]) expect((await fixture(tenant, status).provider.ensure(input)).state).toBe("failed");
  });
  it("creates a stable single-domain tenant with managed HTTP validation and a scoped tag", async () => {
    const { send, provider } = fixture();
    send.mockRejectedValueOnce(Object.assign(new Error("absent"), { name: "EntityNotFound" }));
    expect(await provider.ensure(input)).toEqual({ reference: "edge-id", state: "ready" });
    const created = send.mock.calls[1]![0];
    expect(created.constructor.name).toBe("CreateDistributionTenantCommand");
    expect(created.input).toMatchObject({ Name: "crm-domain-domain-id", DistributionId: "distribution", ConnectionGroupId: "group", Domains: [{ Domain: input.hostname }],
      ManagedCertificateRequest: { ValidationTokenHost: "cloudfront", PrimaryDomainName: input.hostname }, Tags: { Items: [{ Key: "ModularCRMWebsite", Value: "crm-staging" }] } });
  });
  it("recovers an already-created tenant, but never accepts a wrong domain, group or distribution", async () => {
    const { send, provider } = fixture();
    send.mockRejectedValueOnce(Object.assign(new Error("absent"), { name: "EntityNotFound" }));
    send.mockRejectedValueOnce(Object.assign(new Error("exists"), { name: "EntityAlreadyExists" }));
    expect((await provider.ensure(input)).state).toBe("ready");
    for (const changed of [{ DistributionId: "another" }, { ConnectionGroupId: "another" }, { Domains: [{ Domain: "foreign.example.test", Status: "active" }] }, { Name: "crm-domain-other" }]) {
      await expect(fixture({ ...tenant, ...changed }).provider.ensure(input)).rejects.toThrow("binding mismatch");
    }
    const outage = fixture(); outage.send.mockRejectedValueOnce(new Error("unreachable"));
    await expect(outage.provider.ensure(input)).rejects.toThrow("unreachable");
    expect(outage.send).toHaveBeenCalledTimes(1);
  });
  it("uses current ETag, disables before removal and waits for deployment", async () => {
    const enabled = fixture();
    expect(await enabled.provider.remove("edge-id")).toBe(false);
    expect(enabled.send.mock.calls[1]![0]).toMatchObject({ input: { Enabled: false, Id: "edge-id", IfMatch: "version" } });
    const pending = fixture({ ...tenant, Enabled: false, Status: "InProgress" });
    expect(await pending.provider.remove("edge-id")).toBe(false);
    expect(pending.send).toHaveBeenCalledTimes(1);
    const deployed = fixture({ ...tenant, Enabled: false });
    expect(await deployed.provider.remove("edge-id")).toBe(true);
    expect(deployed.send.mock.calls[1]![0].constructor.name).toBe("DeleteDistributionTenantCommand");
    const absent = fixture(); absent.send.mockRejectedValueOnce(Object.assign(new Error("absent"), { name: "EntityNotFound" }));
    expect(await absent.provider.remove("edge-id")).toBe(true);
    await expect(fixture({ ...tenant, DistributionId: "foreign" }).provider.remove("edge-id")).rejects.toThrow("binding mismatch");
  });
  it("waits for issuance before enabling a new tenant", async () => {
    const pending = fixture({ ...tenant, Enabled: false }, "pending-validation");
    expect((await pending.provider.ensure(input)).state).toBe("pending");
    expect(pending.send).toHaveBeenCalledTimes(2);
    const issued = fixture({ ...tenant, Enabled: false });
    expect((await issued.provider.ensure(input)).state).toBe("pending");
    expect(issued.send.mock.calls[2]![0]).toMatchObject({ input: { Id: "edge-id", IfMatch: "version", Enabled: true } });
  });
  it("never enables mocks in production, and requires complete operator configuration", () => {
    expect(createWebsiteHosting({ NODE_ENV: "test", DOMAIN_VERIFICATION_MODE: "mock" }).mock).toBe(true);
    expect(() => createWebsiteHosting({ NODE_ENV: "production", DOMAIN_VERIFICATION_MODE: "mock" }, true)).toThrow("not configured");
    expect(() => createWebsiteHosting({ NODE_ENV: "production", WEBSITE_DOMAIN_PROVIDER: "cloudfront", WEBSITE_ROUTING_TARGET: "elsewhere.example.test" })).toThrow("not configured");
    const real = createWebsiteHosting({ NODE_ENV: "production", WEBSITE_DOMAIN_PROVIDER: "cloudfront", WEBSITE_ROUTING_TARGET: "endpoint.cloudfront.net", WEBSITE_DISTRIBUTION_ID: "distribution", WEBSITE_CONNECTION_GROUP_ID: "group", WEBSITE_RESOURCE_TAG: "crm-production" });
    expect(real.mock).toBe(false); // Constructing a client/resolver does not make an AWS/DNS call.
  });
});
