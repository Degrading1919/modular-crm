import { CloudFrontClient, CreateDistributionTenantCommand, GetDistributionTenantCommand, GetManagedCertificateDetailsCommand,
  UpdateDistributionTenantCommand, DeleteDistributionTenantCommand } from "@aws-sdk/client-cloudfront";
import type { WebsiteEdgeProvider } from "@modular-crm/domain";

export function createCloudFrontWebsiteProvider(distributionId: string, connectionGroupId: string, tag: string,
  client = new CloudFrontClient({ region: "us-east-1", maxAttempts: 1 })): WebsiteEdgeProvider {
  const options = () => ({ abortSignal: AbortSignal.timeout(12_000) });
  const get = (reference: string) => client.send(new GetDistributionTenantCommand({ Identifier: reference }), options());
  return {
    async ensure(input) {
      const name = `crm-domain-${input.id}`;
      let result;
      try { result = await get(input.reference ?? name); }
      catch (error) {
        if ((error as { name?: string }).name !== "EntityNotFound") throw error;
        try {
          await client.send(new CreateDistributionTenantCommand({ DistributionId: distributionId, ConnectionGroupId: connectionGroupId,
            Name: name, Domains: [{ Domain: input.hostname }], Enabled: false,
            ManagedCertificateRequest: { ValidationTokenHost: "cloudfront", PrimaryDomainName: input.hostname, CertificateTransparencyLoggingPreference: "enabled" },
            Tags: { Items: [{ Key: "ModularCRMWebsite", Value: tag }] } }), options());
        } catch (createError) {
          // A previous request can have succeeded before its response was lost.
          if ((createError as { name?: string }).name !== "EntityAlreadyExists") throw createError;
        }
        result = await get(name);
      }
      const tenant = result.DistributionTenant;
      if (!tenant?.Id || tenant.Name !== name || tenant.DistributionId !== distributionId || tenant.ConnectionGroupId !== connectionGroupId
        || tenant.Domains?.length !== 1 || tenant.Domains[0]?.Domain !== input.hostname) throw new Error("Website edge binding mismatch");
      const certificate = await client.send(new GetManagedCertificateDetailsCommand({ Identifier: tenant.Id }), options());
      const status = certificate.ManagedCertificateDetails?.CertificateStatus;
      const failed = ["expired", "validation-timed-out", "revoked", "failed", "inactive"].includes(status ?? "");
      if (failed) return { reference: tenant.Id, state: "failed" };
      // A new certificate may take time. Do not enable a tenant whose secure
      // connection is not issued yet; AWS serves its validation token separately.
      if (status !== "issued") return { reference: tenant.Id, state: "pending" };
      if (!tenant.Enabled) {
        if (!result.ETag) throw new Error("Website edge version missing");
        await client.send(new UpdateDistributionTenantCommand({ Id: tenant.Id, IfMatch: result.ETag!, DistributionId: distributionId,
          ConnectionGroupId: connectionGroupId, Domains: [{ Domain: input.hostname }], Enabled: true, Customizations: tenant.Customizations, Parameters: tenant.Parameters }), options());
        return { reference: tenant.Id, state: "pending" };
      }
      return { reference: tenant.Id, state: tenant.Status === "Deployed" && tenant.Domains[0]?.Status === "active" ? "ready" : "pending" };
    },
    async remove(reference) {
      let result;
      try { result = await get(reference); } catch (error) { if ((error as { name?: string }).name === "EntityNotFound") return true; throw error; }
      const tenant = result.DistributionTenant;
      if (!tenant?.Id || tenant.DistributionId !== distributionId || tenant.ConnectionGroupId !== connectionGroupId || !tenant.Name?.startsWith("crm-domain-")) throw new Error("Website edge binding mismatch");
      if (tenant.Enabled) {
        if (!result.ETag) throw new Error("Website edge version missing");
        await client.send(new UpdateDistributionTenantCommand({ Id: tenant.Id, IfMatch: result.ETag!, DistributionId: distributionId,
          ConnectionGroupId: connectionGroupId, Domains: tenant.Domains?.map(domain => ({ Domain: domain.Domain! })),
          Enabled: false, Customizations: tenant.Customizations, Parameters: tenant.Parameters }), options());
        return false;
      }
      if (tenant.Status !== "Deployed") return false;
      if (!result.ETag) throw new Error("Website edge version missing");
      await client.send(new DeleteDistributionTenantCommand({ Id: tenant.Id, IfMatch: result.ETag! }), options());
      return true;
    },
  };
}
