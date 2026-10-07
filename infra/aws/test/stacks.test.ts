import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { readStageConfig } from "../src/config.ts";
import { createInfrastructure } from "../src/stacks.ts";

const fixture = { domain: "crm.example.test", alarmEmail: "operator@example.test", imageSha: "a".repeat(40), region: "us-east-1",
  postgresVersion: "17.9", smtpHost: "smtp.example.test", smtpFrom: "mail@example.test" };
describe("AWS local-only infrastructure", () => {
  for (const stage of ["staging", "production"] as const) it(`synthesizes and audits ${stage} without credentials or lookups`, () => {
    const values: Record<string, unknown> = { ...fixture, stage };
    const config = readStageConfig((key) => values[key]);
    const app = new App({ outdir: mkdtempSync(join(tmpdir(), `crm-cdk-${stage}-`)), context: { "aws:cdk:availability-zones:account=unknown-account:region=us-east-1": ["us-east-1a", "us-east-1b"] } });
    const stacks = createInfrastructure(app, config);
    // Inspect one identical assembly: fromStack forces a complete re-synth for every assertion group.
    const assembly = app.synth();
    for (const stack of Object.values(stacks)) expect(assembly.getStackArtifact(stack.artifactId).messages.filter((message) => message.level === "error").map((message) => ({ path: message.id, message: message.entry.data }))).toEqual([]);
    const data = Template.fromJSON(assembly.getStackArtifact(stacks.data.artifactId).template);
    data.hasResourceProperties("AWS::RDS::DBInstance", { PubliclyAccessible: false, StorageEncrypted: true, BackupRetentionPeriod: stage === "production" ? 14 : 7,
      DeletionProtection: stage === "production", MultiAZ: stage === "production", MaxAllocatedStorage: Match.anyValue() });
    data.hasResource("AWS::RDS::DBInstance", { DeletionPolicy: "Snapshot", UpdateReplacePolicy: "Snapshot" });
    data.hasResourceProperties("AWS::RDS::DBParameterGroup", { Parameters: { "rds.force_ssl": "1" } });
    const buckets = data.findResources("AWS::S3::Bucket");
    for (const bucket of Object.values(buckets)) expect(bucket.Properties).toMatchObject({ PublicAccessBlockConfiguration: {
      BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true }, BucketEncryption: expect.anything() });
    data.hasResourceProperties("AWS::S3::Bucket", { VersioningConfiguration: { Status: "Enabled" }, LifecycleConfiguration: Match.anyValue() });
    data.hasResourceProperties("AWS::S3::BucketPolicy", { PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Effect: "Deny", Condition: { Bool: { "aws:SecureTransport": "false" } } })]) } });
    const network = Template.fromJSON(assembly.getStackArtifact(stacks.network.artifactId).template);
    network.resourceCountIs("AWS::EC2::VPCEndpoint", 5);
    network.resourceCountIs("AWS::EC2::Subnet", 4);
    const groups = network.findResources("AWS::EC2::SecurityGroup");
    const webGroup = Object.entries(groups).find(([id]) => id.startsWith("WebSecurity"))!;
    const albGroup = Object.entries(groups).find(([id]) => id.startsWith("AlbSecurity"))!;
    const ingress = Object.values(network.findResources("AWS::EC2::SecurityGroupIngress")).map((resource) => resource.Properties);
    const endpoint = Object.entries(groups).find(([id]) => id.startsWith("EndpointSecurity"))!;
    const endpointIngress = [...(endpoint[1].Properties.SecurityGroupIngress ?? []), ...ingress.filter((rule) => JSON.stringify(rule.GroupId) === JSON.stringify({ "Fn::GetAtt": [endpoint[0], "GroupId"] }))];
    expect(endpointIngress).toHaveLength(3);
    for (const rule of endpointIngress) { expect(rule.CidrIp).toBeUndefined(); expect(rule.SourceSecurityGroupId).toBeDefined(); expect(rule.FromPort).toBe(443); }
    expect(ingress.filter((rule) => JSON.stringify(rule.GroupId) === JSON.stringify({ "Fn::GetAtt": [webGroup[0], "GroupId"] }))).toEqual([
      { Description: "Only load balancer", FromPort: 3000, ToPort: 3000, IpProtocol: "tcp", GroupId: { "Fn::GetAtt": [webGroup[0], "GroupId"] }, SourceSecurityGroupId: { "Fn::GetAtt": [albGroup[0], "GroupId"] } }]);
    for (const [id, group] of Object.entries(groups)) if (/WorkerSecurity|MigrateSecurity/.test(id)) {
      expect(group.Properties.SecurityGroupIngress).toBeUndefined();
      expect(ingress.filter((rule) => JSON.stringify(rule.GroupId) === JSON.stringify({ "Fn::GetAtt": [id, "GroupId"] }))).toEqual([]);
    }
    const dbGroups = Object.entries(data.findResources("AWS::EC2::SecurityGroup")).filter(([id]) => id.startsWith("DatabaseSecurity"));
    expect(dbGroups).toHaveLength(1);
    const dbIngress = dbGroups[0][1].Properties.SecurityGroupIngress ?? Object.values(data.findResources("AWS::EC2::SecurityGroupIngress")).map((resource) => resource.Properties);
    expect(dbIngress).toHaveLength(3);
    for (const rule of dbIngress) { expect(rule.FromPort).toBe(5432); expect(rule.CidrIp).toBeUndefined(); expect(rule.SourceSecurityGroupId).toBeDefined(); }
    const appTemplate = Template.fromJSON(assembly.getStackArtifact(stacks.application.artifactId).template);
    appTemplate.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", { Port: 443, Protocol: "HTTPS", Certificates: Match.anyValue() });
    appTemplate.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", { Port: 80, DefaultActions: [{ Type: "redirect", RedirectConfig: { Protocol: "HTTPS", Port: "443", StatusCode: "HTTP_301" } }] });
    appTemplate.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", { TargetType: "ip", HealthCheckPath: "/api/health/ready" });
    for (const [id, resource] of Object.entries(appTemplate.findResources("AWS::ECS::Service"))) {
      expect(resource.Properties.NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp).toBe("DISABLED");
      expect(resource.Properties.DesiredCount).toBe(0);
      expect(resource.Properties.DeploymentConfiguration.DeploymentCircuitBreaker).toEqual({ Enable: true, Rollback: true });
      if (id.startsWith("Worker")) expect(resource.Properties.LoadBalancers).toBeUndefined();
    }
    for (const resource of Object.values(appTemplate.findResources("AWS::ECS::TaskDefinition"))) {
      expect(resource.Properties.TaskRoleArn).not.toEqual(resource.Properties.ExecutionRoleArn);
      for (const container of resource.Properties.ContainerDefinitions) {
        for (const variable of container.Environment ?? []) expect(variable.Name).not.toMatch(/PASSWORD|TOKEN|SECRET|ACCESS_KEY|DATABASE_URL/);
        expect(container.Secrets.map((secret: { Name: string }) => secret.Name)).toContain("DB_PASSWORD");
        for (const name of ["PLATFORM_STRIPE_SECRET_KEY", "PLATFORM_STRIPE_WEBHOOK_SECRET", "PLATFORM_STRIPE_MODE", "PLATFORM_BILLING_PLANS_JSON", "PLATFORM_OPERATOR_USER_IDS", "PLATFORM_BILLING_TRIAL_DAYS", "PLATFORM_BILLING_GRACE_DAYS"]) {
          expect(container.Secrets.map((secret: { Name: string }) => secret.Name).includes(name)).toBe(container.Name !== "migrate");
          expect((container.Environment ?? []).some((variable: { Name: string }) => variable.Name === name)).toBe(false);
        }
        expect(container.Image).toEqual(expect.objectContaining({ "Fn::Join": expect.anything() }));
        if (container.Name === "worker") expect(container.HealthCheck.Command).toEqual(["CMD", "node", "containers/probe.mjs", "live", "worker"]);
      }
    }
    for (const resource of Object.values(appTemplate.findResources("AWS::Logs::LogGroup"))) expect(resource.Properties.RetentionInDays).toBe(stage === "production" ? 90 : 30);
    appTemplate.resourceCountIs("AWS::CloudWatch::Alarm", 7);
    appTemplate.hasResourceProperties("AWS::SNS::Subscription", { Protocol: "email", Endpoint: fixture.alarmEmail });
    appTemplate.resourceCountIs("AWS::WAFv2::WebACL", stage === "production" ? 1 : 0);
    const containers = Object.values(appTemplate.findResources("AWS::ECS::TaskDefinition")).flatMap((resource) => resource.Properties.ContainerDefinitions);
    const secret = (name: string, key: string) => containers.find((container) => container.Name === name).Secrets.find((value: { Name: string }) => value.Name === key).ValueFrom;
    expect(secret("web", "DB_PASSWORD")).toEqual(secret("worker", "DB_PASSWORD"));
    expect(secret("web", "DB_PASSWORD")).not.toEqual(secret("migrate", "DB_PASSWORD"));
    expect(secret("web", "DB_PASSWORD")).toEqual(secret("migrate", "DB_RUNTIME_PASSWORD"));
    if (stage === "production") {
      const rules = Object.values(appTemplate.findResources("AWS::WAFv2::WebACL"))[0].Properties.Rules;
      expect(rules[0].Statement.ManagedRuleGroupStatement.RuleActionOverrides).toEqual([{ Name: "SizeRestrictions_BODY", ActionToUse: { Count: {} } }]);
      expect(rules[0].OverrideAction).toEqual({ None: {} });
      expect(rules[1].Action).toEqual({ Block: {} });
      expect(rules[1].Priority).toBeGreaterThan(rules[0].Priority);
      const sizeStatements = rules[1].Statement.AndStatement.Statements;
      expect(sizeStatements).toHaveLength(2);
      expect(sizeStatements[0]).toEqual({ LabelMatchStatement: { Scope: "LABEL", Key: "awswaf:managed:aws:core-rule-set:SizeRestrictions_Body" } });
      expect(sizeStatements[1]).toEqual({ RegexMatchStatement: { FieldToMatch: { UriPath: {} },
        RegexString: "^/api/(auth|v1/(public|auth))(/|$)", TextTransformations: [{ Priority: 0, Type: "NONE" }] } });
      // Evaluate the synthesized URI matcher, not a separate application-side copy.
      // No method/cookie/header predicate: PATCH saves and POST saves behave alike,
      // and a forged session cookie cannot exempt an oversized public submission.
      const publicPath = new RegExp(sizeStatements[1].RegexMatchStatement.RegexString);
      for (const path of ["/api/auth", "/api/auth/sign-in/email", "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/portal-activate",
        "/api/v1/public", "/api/v1/public/quote", "/api/v1/public/signup", "/api/v1/public/forms", "/api/v1/public/estimate-links/token/approve"]) {
        expect(publicPath.test(path), `oversized public request: ${path}`).toBe(true);
      }
      for (const path of ["/api/v1/estimates", "/api/v1/estimates/id/revisions", "/api/v1/invoices", "/api/v1/invoices/id",
        "/api/v1/imports", "/api/v1/field/jobs/id/note", "/api/v1/field/jobs/id/complete", "/api/v1/portal/profile",
        "/api/v1/publicity", "/api/v1/authorizations", "/api/authenticated"]) {
        expect(publicPath.test(path), `no size-only block on authenticated/other route: ${path}`).toBe(false);
      }
      expect(rules[2]).toMatchObject({ Action: { Block: {} }, Statement: { RateBasedStatement: { Limit: 2000, AggregateKeyType: "IP" } } });
      for (const rule of rules) expect(rule.VisibilityConfig.SampledRequestsEnabled).toBe(false);
    }
  });
  it("reports missing context and invalid values clearly", () => {
    for (const key of ["domain", "alarmEmail"]) expect(() => readStageConfig((name) => name === key ? undefined : ({ ...fixture, stage: "staging" } as Record<string, unknown>)[name])).toThrow(`${key} is required`);
    expect(() => readStageConfig((key) => ({ ...fixture, stage: "staging", imageSha: "latest" } as Record<string, unknown>)[key])).toThrow("full lowercase git SHA");
    for (const stage of ["staging", "production"]) {
      const ceiling = stage === "production" ? 1000 : 100, minimum = stage === "production" ? 100 : 20;
      for (const restoreAllocatedStorage of [minimum - 1, ceiling, "", "wrong", 50.5]) expect(() => readStageConfig(key => ({ ...fixture, stage, restoreSnapshot: "crm-snapshot", restoreAllocatedStorage } as Record<string, unknown>)[key])).toThrow("restoreAllocatedStorage");
    }
    expect(() => readStageConfig(key => ({ ...fixture, stage: "production", restoreAllocatedStorage: 300 } as Record<string, unknown>)[key])).toThrow("requires restoreSnapshot");
  });
  it("restores into a parallel protected database and activates only migrated task capacity", () => {
    const values: Record<string, unknown> = { ...fixture, stage: "production", active: true, restoreSnapshot: "crm-reviewed-snapshot", restoreAllocatedStorage: 300, sesDomain: "example.test" };
    const app = new App({ outdir: mkdtempSync(join(tmpdir(), "crm-cdk-restore-")) });
    const stacks = createInfrastructure(app, readStageConfig((key) => values[key]));
    const assembly = app.synth();
    for (const stack of Object.values(stacks)) expect(assembly.getStackArtifact(stack.artifactId).messages.filter((message) => message.level === "error")).toEqual([]);
    const data = Template.fromJSON(assembly.getStackArtifact(stacks.data.artifactId).template);
    data.resourceCountIs("AWS::RDS::DBInstance", 2);
    data.hasResourceProperties("AWS::RDS::DBInstance", { DBSnapshotIdentifier: "crm-reviewed-snapshot", DeletionProtection: true, PubliclyAccessible: false });
    const restored = Object.values(data.findResources("AWS::RDS::DBInstance")).find((resource) => resource.Properties.DBSnapshotIdentifier);
    expect(Number(restored!.Properties.AllocatedStorage)).toBe(300);
    for (const forbidden of ["StorageEncrypted", "KmsKeyId", "DBName", "MasterUsername", "MasterUserPassword"]) expect(restored!.Properties[forbidden]).toBeUndefined();
    const application = Template.fromJSON(assembly.getStackArtifact(stacks.application.artifactId).template);
    application.hasResourceProperties("AWS::ECS::Service", { DesiredCount: 2 });
    application.hasResourceProperties("AWS::ApplicationAutoScaling::ScalableTarget", { MinCapacity: 2, MaxCapacity: 6 });
    application.resourceCountIs("AWS::SES::EmailIdentity", 1);
  });
  it("inherits snapshot storage when the operator has not requested an increase", () => {
    const values: Record<string, unknown> = { ...fixture, stage: "staging", restoreSnapshot: "crm-grown-snapshot" };
    const app = new App({ outdir: mkdtempSync(join(tmpdir(), "crm-cdk-inherit-")) });
    const stacks = createInfrastructure(app, readStageConfig(key => values[key]));
    const assembly = app.synth();
    const data = Template.fromJSON(assembly.getStackArtifact(stacks.data.artifactId).template);
    const restored = Object.values(data.findResources("AWS::RDS::DBInstance")).find(resource => resource.Properties.DBSnapshotIdentifier);
    expect(restored!.Properties.AllocatedStorage).toBeUndefined();
    const original = Object.values(data.findResources("AWS::RDS::DBInstance")).find(resource => !resource.Properties.DBSnapshotIdentifier);
    expect(Number(original!.Properties.AllocatedStorage)).toBe(20);
  });
  it("keeps release out of CI and migration before rollout", () => {
    const script = readFileSync(new URL("../scripts/release.sh", import.meta.url), "utf8");
    expect(script.indexOf('[[ "$migration_exit"')).toBeLessThan(script.indexOf('\naws ecs update-service'));
    expect(script).toContain('services-stable');
    expect(script).toContain('ROLLBACK');
    expect(script).toContain('exit 1');
  });
});
