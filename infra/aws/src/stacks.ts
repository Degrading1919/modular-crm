import { App, ArnFormat, Aspects, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as ses from "aws-cdk-lib/aws-ses";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import type { StageConfig } from "./config.ts";
import { createHash } from "node:crypto";

export function createInfrastructure(app: App, config: StageConfig) {
  const prod = config.stage === "production";
  const props: StackProps = { env: { account: config.account, region: config.region }, terminationProtection: prod };
  const prefix = `crm-${config.stage}`;
  const network = new Stack(app, `${prefix}-network`, props);
  const data = new Stack(app, `${prefix}-data`, props);
  const application = new Stack(app, `${prefix}-app`, props);
  for (const stack of [network, data, application]) {
    Tags.of(stack).add("Application", "ModularCRM");
    Tags.of(stack).add("Stage", config.stage);
  }
  const vpc = new ec2.Vpc(network, "Vpc", { maxAzs: 2, natGateways: config.natGateways,
    subnetConfiguration: [{ name: "Public", subnetType: ec2.SubnetType.PUBLIC },
      { name: "Private", subnetType: config.natGateways ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PRIVATE_ISOLATED }] });
  const privateSubnets = { subnetType: config.natGateways ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PRIVATE_ISOLATED };
  const retention = prod ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH;
  const flowLogs = new logs.LogGroup(network, "FlowLogs", { retention, removalPolicy: RemovalPolicy.RETAIN });
  vpc.addFlowLog("FlowLog", { destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogs) });
  const albSg = new ec2.SecurityGroup(network, "AlbSecurity", { vpc, allowAllOutbound: false });
  albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS from customers");
  albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Redirect only");
  NagSuppressions.addResourceSuppressions(albSg, [{ id: "AwsSolutions-EC23", reason: "Public customers require only TCP 443 and TCP 80 redirect; no other inbound ports. Tasks and database remain private and security-group scoped." }]);
  const webSg = new ec2.SecurityGroup(network, "WebSecurity", { vpc });
  const workerSg = new ec2.SecurityGroup(network, "WorkerSecurity", { vpc });
  const migrateSg = new ec2.SecurityGroup(network, "MigrateSecurity", { vpc });
  webSg.addIngressRule(albSg, ec2.Port.tcp(3000), "Only load balancer");
  albSg.addEgressRule(webSg, ec2.Port.tcp(3000), "Only web targets");
  const endpointSg = new ec2.SecurityGroup(network, "EndpointSecurity", { vpc, allowAllOutbound: false });
  for (const sg of [webSg, workerSg, migrateSg]) endpointSg.addIngressRule(sg, ec2.Port.tcp(443), "Private task API access");
  for (const [id, service] of Object.entries({ Ecr: ec2.InterfaceVpcEndpointAwsService.ECR, EcrDocker: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
    Logs: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS, Secrets: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER })) {
    vpc.addInterfaceEndpoint(id, { service, subnets: privateSubnets, securityGroups: [endpointSg], privateDnsEnabled: true, open: false });
  }
  vpc.addGatewayEndpoint("S3", { service: ec2.GatewayVpcEndpointAwsService.S3, subnets: [privateSubnets] });
  const dbKey = new kms.Key(data, "DatabaseKey", { enableKeyRotation: true, removalPolicy: RemovalPolicy.RETAIN });
  const dbSg = new ec2.SecurityGroup(data, "DatabaseSecurity", { vpc, allowAllOutbound: false });
  for (const sg of [webSg, workerSg, migrateSg]) dbSg.addIngressRule(sg, ec2.Port.tcp(5432), "Task database access only");
  const engine = rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.of(config.postgresVersion, config.postgresVersion.split(".")[0]) });
  const parameters = new rds.ParameterGroup(data, "DatabaseParameters", { engine, parameters: { "rds.force_ssl": "1" } });
  const databaseId = `${prefix}-postgres`;
  const databaseLogs = ["postgresql", "upgrade"].map((name) => new logs.LogGroup(data, `${name}DatabaseLogs`, { logGroupName: `/aws/rds/instance/${databaseId}/${name}`, retention, removalPolicy: RemovalPolicy.RETAIN }));
  const databaseProps: rds.DatabaseInstanceProps = { engine, parameterGroup: parameters, vpc, vpcSubnets: privateSubnets,
    securityGroups: [dbSg], publiclyAccessible: false, storageEncrypted: true, storageEncryptionKey: dbKey,
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, prod ? ec2.InstanceSize.MEDIUM : ec2.InstanceSize.SMALL),
    instanceIdentifier: databaseId, databaseName: "modular_crm", credentials: rds.Credentials.fromGeneratedSecret("crm_operator"), allocatedStorage: prod ? 100 : 20,
    maxAllocatedStorage: prod ? 1000 : 100, storageType: rds.StorageType.GP3, multiAz: config.multiAz,
    backupRetention: Duration.days(prod ? 14 : 7), deletionProtection: prod, removalPolicy: RemovalPolicy.SNAPSHOT,
    cloudwatchLogsExports: ["postgresql", "upgrade"], autoMinorVersionUpgrade: true,
    monitoringInterval: Duration.seconds(60), copyTagsToSnapshot: true };
  const originalDatabase = new rds.DatabaseInstance(data, "Database", databaseProps);
  originalDatabase.node.addDependency(...databaseLogs);
  let database: rds.DatabaseInstance | rds.DatabaseInstanceFromSnapshot = originalDatabase;
  if (config.restoreSnapshot) {
    const suffix = createHash("sha256").update(config.restoreSnapshot).digest("hex").slice(0, 8);
    const restoredId = `${prefix}-restore-${suffix}`;
    const restoredLogs = ["postgresql", "upgrade"].map((name) => new logs.LogGroup(data, `${name}RestoreLogs${suffix}`, { logGroupName: `/aws/rds/instance/${restoredId}/${name}`, retention, removalPolicy: RemovalPolicy.RETAIN }));
    database = new rds.DatabaseInstanceFromSnapshot(data, `RestoredDatabase${suffix}`, { ...databaseProps, instanceIdentifier: restoredId,
      snapshotIdentifier: config.restoreSnapshot, credentials: undefined, databaseName: undefined });
    // Snapshot encryption/master identity are inherited, not creation properties. The operator
    // must verify encryption and restore the matching administrator password before release.
    NagSuppressions.addResourceSuppressions(database, [{ id: "AwsSolutions-RDS2", reason: "Restore inherits encryption/KMS from the operator-verified encrypted snapshot; CloudFormation forbids creation-time encryption overrides when restoring." }]);
    database.node.addDependency(...restoredLogs);
  }
  for (const instance of new Set([database, originalDatabase])) {
  if (!prod) NagSuppressions.addResourceSuppressions(instance, [{ id: "AwsSolutions-RDS10", reason: "Staging can be decommissioned by an operator; final snapshot is still required. Production has deletion protection and stack termination protection." }]);
  NagSuppressions.addResourceSuppressions(instance, [
    { id: "AwsSolutions-RDS3", reason: "Staging defaults Single-AZ; production defaults Multi-AZ, configurable for an explicit operator topology choice." },
    { id: "AwsSolutions-RDS6", reason: "Password is generated by Secrets Manager and only injected into ECS tasks; IAM DB authentication is not supported by the portable pg/pg-boss runtime." },
    { id: "AwsSolutions-RDS11", reason: "PostgreSQL uses its standard private 5432 port; the security group permits only the three task groups." },
    { id: "AwsSolutions-SMG4", reason: "Automatic DB password rotation requires coordinated service replacement; use the documented rotate-and-release procedure rather than breaking existing task connections." },
    { id: "AwsSolutions-IAM4", reason: "RDS enhanced monitoring uses the AWS-required service monitoring policy, not an application role." },
  ], true);
  }
  const accessLogs = new s3.Bucket(data, "AccessLogs", { blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, enforceSSL: true,
    encryption: s3.BucketEncryption.S3_MANAGED, removalPolicy: RemovalPolicy.RETAIN, lifecycleRules: [{ expiration: Duration.days(90) }] });
  NagSuppressions.addResourceSuppressions(accessLogs, [{ id: "AwsSolutions-S1", reason: "Dedicated access-log sink; recursive access logging would create an unbounded logging loop." }]);
  const files = new s3.Bucket(data, "Files", { blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, enforceSSL: true,
    encryption: s3.BucketEncryption.S3_MANAGED, versioned: true, removalPolicy: RemovalPolicy.RETAIN,
    serverAccessLogsBucket: accessLogs, serverAccessLogsPrefix: "files/", lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(90), abortIncompleteMultipartUploadAfter: Duration.days(7) }] });
  const runtime = new secrets.Secret(data, "RuntimeSecrets", { description: "Populate JSON runtime keys securely before the first release; never commit or print values." });
  NagSuppressions.addResourceSuppressions(runtime, [{ id: "AwsSolutions-SMG4", reason: "Application encryption keys require an explicit data re-encryption plan; automatic replacement would make tenant credentials unreadable." }]);
  const mail = new secrets.Secret(data, "SmtpSecrets", { description: "Populate JSON username/password from the chosen production SMTP provider before release." });
  const runtimeDatabase = new secrets.Secret(data, "RuntimeDatabaseIdentity", { generateSecretString: { secretStringTemplate: JSON.stringify({ username: "crm_runtime" }), generateStringKey: "password", passwordLength: 40, excludePunctuation: true } });
  NagSuppressions.addResourceSuppressions(runtimeDatabase, [{ id: "AwsSolutions-SMG4", reason: "The migration task applies credential changes and schema grants before replacing services; uncoordinated automatic rotation would break live pools." }]);
  NagSuppressions.addResourceSuppressions(mail, [{ id: "AwsSolutions-SMG4", reason: "External SMTP credentials rotate at the provider followed by ECS task replacement; this stack cannot rotate an arbitrary provider." }]);
  if (config.sesDomain) new ses.EmailIdentity(application, "EmailIdentity", { identity: ses.Identity.domain(config.sesDomain), dkimSigning: true });
  const cluster = new ecs.Cluster(application, "Cluster", { vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });
  const repositories: Record<string, ecr.Repository> = {};
  const definitions: Record<string, ecs.FargateTaskDefinition> = {};
  const commonEnvironment = { NODE_ENV: "production", MOCK_CONNECTORS: "false", DOMAIN_VERIFICATION_MODE: "dns",
    TRUSTED_PROXY_HOPS: "1", APP_BASE_URL: `https://${config.domain}`, BETTER_AUTH_URL: `https://${config.domain}`, PUBLIC_BASE_URL: `https://${config.domain}`,
    DB_HOST: database.dbInstanceEndpointAddress, DB_PORT: database.dbInstanceEndpointPort, DB_NAME: "modular_crm", DB_SSL: "true",
    NODE_EXTRA_CA_CERTS: "/app/containers/rds-ca.pem", SMTP_HOST: config.smtpHost, SMTP_PORT: "587", SMTP_SECURE: "false", SMTP_FROM: config.smtpFrom,
    OBJECT_STORAGE_ENDPOINT: `https://s3.${config.region}.${application.urlSuffix}`, OBJECT_STORAGE_BUCKET: files.bucketName,
    OBJECT_STORAGE_REGION: config.region, OBJECT_STORAGE_CREDENTIAL_MODE: "task-role", OBJECT_STORAGE_FORCE_PATH_STYLE: "false" };
  for (const name of ["web", "worker", "migrate"] as const) {
    const repository = new ecr.Repository(application, `${name}Repository`, { imageScanOnPush: true, imageTagMutability: ecr.TagMutability.IMMUTABLE,
      removalPolicy: RemovalPolicy.RETAIN });
    repositories[name] = repository;
    const taskRole = new iam.Role(application, `${name}TaskRole`, { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com") });
    if (name !== "migrate") {
      files.grantReadWrite(taskRole, "tenants/*");
      NagSuppressions.addResourceSuppressions(taskRole, [{ id: "AwsSolutions-IAM5", reason: "Storage methods need object operations on this bucket's tenant-prefixed keys; CDK grants no other bucket, and the adapter enforces tenant ownership." }], true);
    }
    const executionRole = new iam.Role(application, `${name}ExecutionRole`, { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com") });
    const definition = new ecs.FargateTaskDefinition(application, `${name}Task`, { cpu: 512, memoryLimitMiB: 1024, taskRole, executionRole,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX } });
    definitions[name] = definition;
    const logGroup = new logs.LogGroup(application, `${name}Logs`, { retention, removalPolicy: RemovalPolicy.RETAIN });
    const databaseIdentity = name === "migrate" ? originalDatabase.secret! : runtimeDatabase;
    const injected: Record<string, ecs.Secret> = { DB_USERNAME: ecs.Secret.fromSecretsManager(databaseIdentity, "username"), DB_PASSWORD: ecs.Secret.fromSecretsManager(databaseIdentity, "password") };
    if (name === "migrate") {
      injected.DB_RUNTIME_USERNAME = ecs.Secret.fromSecretsManager(runtimeDatabase, "username");
      injected.DB_RUNTIME_PASSWORD = ecs.Secret.fromSecretsManager(runtimeDatabase, "password");
    }
    if (name !== "migrate") {
      for (const key of ["BETTER_AUTH_SECRET", "WEBHOOK_SECRET_ENCRYPTION_KEY", "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY"]) injected[key] = ecs.Secret.fromSecretsManager(runtime, key);
      injected.SMTP_USER = ecs.Secret.fromSecretsManager(mail, "username");
      injected.SMTP_PASSWORD = ecs.Secret.fromSecretsManager(mail, "password");
    }
    const container = definition.addContainer(name, { image: ecs.ContainerImage.fromEcrRepository(repository, config.imageSha),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: name, logGroup }), environment: name === "migrate" ? { DB_HOST: commonEnvironment.DB_HOST, DB_PORT: commonEnvironment.DB_PORT,
        DB_NAME: commonEnvironment.DB_NAME, DB_SSL: "true", NODE_EXTRA_CA_CERTS: commonEnvironment.NODE_EXTRA_CA_CERTS } : commonEnvironment,
      secrets: injected, stopTimeout: Duration.seconds(60), readonlyRootFilesystem: true,
      ...(name !== "migrate" ? { healthCheck: { command: ["CMD", "node", "containers/probe.mjs", "live", name], interval: Duration.seconds(30),
        timeout: Duration.seconds(5), retries: 3, startPeriod: Duration.seconds(60) } } : {}) });
    if (name === "web") container.addPortMappings({ containerPort: 3000 });
    definition.addVolume({ name: "temporary" });
    container.addMountPoints({ sourceVolume: "temporary", containerPath: "/tmp", readOnly: false });
    if (name === "web") {
      definition.addVolume({ name: "next-cache" });
      container.addMountPoints({ sourceVolume: "next-cache", containerPath: "/app/apps/web/.next/cache", readOnly: false });
    }
    NagSuppressions.addResourceSuppressions(executionRole, [{ id: "AwsSolutions-IAM5", reason: "ECR GetAuthorizationToken requires Resource *; image pulls are repository-scoped, log writes group-scoped and secrets reads limited to injected secrets." }], true);
    NagSuppressions.addResourceSuppressions(definition, [{ id: "AwsSolutions-ECS2", reason: "Only non-sensitive public configuration is environment; DB/auth/encryption/SMTP credentials use ECS Secrets Manager injection, asserted in tests." }]);
  }
  // Do not start any tasks before images, secrets and migrations exist. release.sh transitions these from zero safely.
  const web = new ecs.FargateService(application, "Web", { cluster, taskDefinition: definitions.web, desiredCount: config.active ? config.webCount : 0,
    securityGroups: [webSg], vpcSubnets: privateSubnets, assignPublicIp: false, platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
    healthCheckGracePeriod: Duration.seconds(120), circuitBreaker: { rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200 });
  const worker = new ecs.FargateService(application, "Worker", { cluster, taskDefinition: definitions.worker, desiredCount: config.active ? config.workerCount : 0,
    securityGroups: [workerSg], vpcSubnets: privateSubnets, assignPublicIp: false, platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
    circuitBreaker: { rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200 });
  web.autoScaleTaskCount({ minCapacity: config.active ? config.webCount : 0, maxCapacity: 6 }).scaleOnCpuUtilization("CpuScaling", { targetUtilizationPercent: 60,
    scaleInCooldown: Duration.seconds(300), scaleOutCooldown: Duration.seconds(60) });
  const alb = new elbv2.ApplicationLoadBalancer(application, "LoadBalancer", { vpc, internetFacing: true, securityGroup: albSg, dropInvalidHeaderFields: true });
  alb.logAccessLogs(accessLogs, "alb");
  const certificate = new acm.Certificate(application, "Certificate", { domainName: config.domain, validation: acm.CertificateValidation.fromDns() });
  const listener = alb.addListener("Https", { port: 443, certificates: [certificate], sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS, open: false });
  const target = listener.addTargets("WebTargets", { port: 3000, protocol: elbv2.ApplicationProtocol.HTTP, targets: [web],
    healthCheck: { path: "/api/health/ready", healthyHttpCodes: "200" }, deregistrationDelay: Duration.seconds(30) });
  alb.addListener("HttpRedirect", { port: 80, open: false, defaultAction: elbv2.ListenerAction.redirect({ protocol: "HTTPS", port: "443", permanent: true }) });
  if (config.waf) {
    const acl = new wafv2.CfnWebACL(application, "WebAcl", { scope: "REGIONAL", defaultAction: { allow: {} },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: `${prefix}-waf`, sampledRequestsEnabled: false }, rules: [
        { name: "Common", priority: 0, overrideAction: { none: {} }, statement: { managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet",
          ruleActionOverrides: [{ name: "SizeRestrictions_BODY", actionToUse: { count: {} } }] } },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "Common", sampledRequestsEnabled: false } },
        // WAF cannot authenticate sessions. Match public/sign-in route namespaces, not a
        // spoofable Cookie header or an upload-only POST exception. Authenticated API
        // routes still enforce authorization and the application's 2 MB body limit.
        { name: "LargeBodyPublicRequests", priority: 1, action: { block: {} }, statement: { andStatement: { statements: [
          { labelMatchStatement: { scope: "LABEL", key: "awswaf:managed:aws:core-rule-set:SizeRestrictions_Body" } },
          { regexMatchStatement: { fieldToMatch: { uriPath: {} }, regexString: "^/api/(auth|v1/(public|auth))(/|$)", textTransformations: [{ priority: 0, type: "NONE" }] } },
        ] } }, visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "LargeBodyPublicRequests", sampledRequestsEnabled: false } },
        { name: "RateLimit", priority: 2, action: { block: {} }, statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: "IP" } },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "RateLimit", sampledRequestsEnabled: false } }] });
    new wafv2.CfnWebACLAssociation(application, "WebAclAssociation", { resourceArn: alb.loadBalancerArn, webAclArn: acl.attrArn });
  } else NagSuppressions.addResourceSuppressions(alb, [{ id: "AwsSolutions-ELB2", reason: "WAF defaults enabled in production; staging or explicit operator opt-out retains HTTPS and application request limits." }]);
  const alarmKey = new kms.Key(application, "AlarmKey", { enableKeyRotation: true });
  alarmKey.addToResourcePolicy(new iam.PolicyStatement({ principals: [new iam.ServicePrincipal("cloudwatch.amazonaws.com")], actions: ["kms:Decrypt", "kms:GenerateDataKey*"], resources: ["*"],
    conditions: { StringEquals: { "aws:SourceAccount": application.account }, ArnLike: { "aws:SourceArn": application.formatArn({ service: "cloudwatch", resource: "alarm", resourceName: "*", arnFormat: ArnFormat.COLON_RESOURCE_NAME }) } } }));
  const topic = new sns.Topic(application, "AlarmTopic", { masterKey: alarmKey });
  topic.addSubscription(new subscriptions.EmailSubscription(config.alarmEmail));
  const alarm = (id: string, metric: cloudwatch.IMetric, threshold: number, below = false, missing = cloudwatch.TreatMissingData.NOT_BREACHING) => {
    const result = new cloudwatch.Alarm(application, id, { metric, threshold, evaluationPeriods: 3, datapointsToAlarm: 2,
      comparisonOperator: below ? cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD : cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD, treatMissingData: missing });
    result.addAlarmAction(new actions.SnsAction(topic));
  };
  alarm("Alb5xx", alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { period: Duration.minutes(1), statistic: "Sum" }), 5);
  alarm("UnhealthyTargets", target.metrics.unhealthyHostCount({ period: Duration.minutes(1), statistic: "Maximum" }), 0);
  for (const [name, service] of [["Web", web], ["Worker", worker]] as const) {
    const metric = (metricName: string) => new cloudwatch.Metric({ namespace: "ECS/ContainerInsights", metricName, dimensionsMap: { ClusterName: cluster.clusterName, ServiceName: service.serviceName }, period: Duration.minutes(1), statistic: "Minimum" });
    alarm(`${name}Capacity`, new cloudwatch.MathExpression({ expression: "IF(desired > 0, running - desired, 0)", usingMetrics: { running: metric("RunningTaskCount"), desired: metric("DesiredTaskCount") }, period: Duration.minutes(1) }), 0, true, config.active ? cloudwatch.TreatMissingData.BREACHING : cloudwatch.TreatMissingData.NOT_BREACHING);
  }
  alarm("DatabaseCpu", database.metricCPUUtilization({ period: Duration.minutes(1) }), 80);
  alarm("DatabaseStorage", database.metricFreeStorageSpace({ period: Duration.minutes(1) }), 5 * 1024 ** 3, true);
  alarm("DatabaseConnections", database.metricDatabaseConnections({ period: Duration.minutes(1) }), prod ? 200 : 100);
  const output = (id: string, value: string) => { const result = new CfnOutput(application, `Output${id}`, { value }); result.overrideLogicalId(id); };
  output("Stage", config.stage); output("Region", config.region); output("Cluster", cluster.clusterName);
  output("WebService", web.serviceName); output("WorkerService", worker.serviceName);
  output("WebCount", String(config.webCount)); output("WorkerCount", String(config.workerCount));
  output("PrivateSubnets", vpc.selectSubnets(privateSubnets).subnetIds.join(",")); output("MigrateSecurityGroup", migrateSg.securityGroupId);
  output("LoadBalancerDns", alb.loadBalancerDnsName); output("RuntimeSecretArn", runtime.secretArn); output("SmtpSecretArn", mail.secretArn);
  output("DatabaseId", database.instanceIdentifier); output("DatabaseHost", database.dbInstanceEndpointAddress);
  for (const name of ["web", "worker", "migrate"]) { output(`${name}Repository`, repositories[name].repositoryUri); output(`${name}TaskDefinition`, definitions[name].taskDefinitionArn); }
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
  return { network, data, application };
}
