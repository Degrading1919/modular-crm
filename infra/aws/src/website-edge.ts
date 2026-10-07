import { ArnFormat, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import { NagSuppressions } from "cdk-nag";

/** One shared edge configuration; verified customer domains/certificates are
 * distribution tenants created by the worker, not per-customer CDK edits. */
export function createWebsiteEdge(stack: Stack, prefix: string, originHostname: string) {
  const originSecret = new secrets.Secret(stack, "WebsiteOriginSecret", { generateSecretString: { passwordLength: 48, excludePunctuation: true }, removalPolicy: RemovalPolicy.RETAIN });
  NagSuppressions.addResourceSuppressions(originSecret, [{ id: "AwsSolutions-SMG4", reason: "Rotate with the documented coordinated CloudFront-origin and ECS replacement procedure; uncoordinated rotation denies legitimate website traffic." }]);
  const hostFunction = new cloudfront.Function(stack, "WebsiteHostFunction", { runtime: cloudfront.FunctionRuntime.JS_2_0,
    code: cloudfront.FunctionCode.fromInline("function handler(event) { var r = event.request; r.headers['x-website-host'] = { value: r.headers.host.value }; delete r.headers['x-website-origin-key']; return r; }") });
  const group = new cloudfront.CfnConnectionGroup(stack, "WebsiteConnectionGroup", { name: `${prefix}-websites`, enabled: true, ipv6Enabled: true });
  const distribution = new cloudfront.CfnDistribution(stack, "WebsiteDistribution", { distributionConfig: {
    enabled: true, connectionMode: "tenant-only", tenantConfig: { parameterDefinitions: [] }, httpVersion: "http2and3",
    comment: "Verified owner websites only; staff application stays on its workspace hostname",
    origins: [{ id: "workspace-origin", domainName: originHostname,
      customOriginConfig: { originProtocolPolicy: "https-only", originSslProtocols: ["TLSv1.2"], httpsPort: 443 },
      originCustomHeaders: [{ headerName: "x-website-origin-key", headerValue: originSecret.secretValue.unsafeUnwrap() }] }],
    defaultCacheBehavior: { targetOriginId: "workspace-origin", viewerProtocolPolicy: "redirect-to-https", compress: true,
      allowedMethods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"], cachedMethods: ["GET", "HEAD"],
      cachePolicyId: cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId,
      originRequestPolicyId: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId,
      functionAssociations: [{ eventType: "viewer-request", functionArn: hostFunction.functionArn }] },
    viewerCertificate: { cloudFrontDefaultCertificate: false, minimumProtocolVersion: "TLSv1.2_2021", sslSupportMethod: "sni-only" },
  } });
  // Multi-tenant distributions explicitly do not support legacy Logging. The
  // origin's retained ALB access logs and application structured logs remain on.
  NagSuppressions.addResourceSuppressions(distribution, [
    { id: "AwsSolutions-CFR1", reason: "Business websites are public worldwide; geographic restriction would break owners' legitimate customers." },
    { id: "AwsSolutions-CFR2", reason: "The existing HTTPS ALB origin is protected by the production regional WAF. This slice does not create a second global ACL or change WAF protection." },
    { id: "AwsSolutions-CFR3", reason: "CloudFront SaaS Manager does not support legacy Logging; ALB retained access logs and application logs cover origin traffic. See DEPLOYMENT for optional standard logging v2." },
    { id: "AwsSolutions-CFR4", reason: "Each verified distribution tenant requests its own managed certificate via CreateDistributionTenant, with TLSv1.2_2021 inherited here; no customer certificate belongs on the shared distribution." },
  ]);
  const tenantArn = stack.formatArn({ service: "cloudfront", region: "", resource: "distribution-tenant", resourceName: "*", arnFormat: ArnFormat.SLASH_RESOURCE_NAME });
  // Actions generated offline by iam-policy-autopilot 0.3.0 from the SDK
  // adapter. Narrow to this stage's tag/account; omit conditional GetVpcOrigin
  // because this distribution uses only an HTTPS custom origin, never VPC origins.
  const permissions = [
    new iam.PolicyStatement({ actions: ["cloudfront:CreateDistributionTenant"], resources: ["*"], conditions: {
      StringEquals: { "aws:RequestTag/ModularCRMWebsite": prefix }, "ForAllValues:StringEquals": { "aws:TagKeys": ["ModularCRMWebsite"] }, Null: { "aws:TagKeys": "false" } } }),
    new iam.PolicyStatement({ actions: ["cloudfront:TagResource"], resources: [tenantArn], conditions: { StringEquals: { "aws:RequestTag/ModularCRMWebsite": prefix },
      "ForAllValues:StringEquals": { "aws:TagKeys": ["ModularCRMWebsite"] }, Null: { "aws:TagKeys": "false" } } }),
    new iam.PolicyStatement({ actions: ["cloudfront:DeleteDistributionTenant", "cloudfront:GetDistributionTenant", "cloudfront:GetManagedCertificateDetails", "cloudfront:UpdateDistributionTenant"],
      resources: [tenantArn], conditions: { StringEquals: { "aws:ResourceTag/ModularCRMWebsite": prefix } } }),
  ];
  return { distribution, group, originSecret, permissions, environment: {
    WEBSITE_DOMAIN_PROVIDER: "cloudfront", WEBSITE_DISTRIBUTION_ID: distribution.ref, WEBSITE_CONNECTION_GROUP_ID: group.attrId,
    WEBSITE_ROUTING_TARGET: group.attrRoutingEndpoint, WEBSITE_RESOURCE_TAG: prefix } };
}
