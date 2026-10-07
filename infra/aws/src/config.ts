export type StageConfig = Readonly<{
  stage: "staging" | "production";
  region: string;
  account?: string;
  domain: string;
  alarmEmail: string;
  imageSha: string;
  postgresVersion: string;
  natGateways: number;
  multiAz: boolean;
  waf: boolean;
  active: boolean;
  sesDomain?: string;
  smtpHost: string;
  smtpFrom: string;
  webCount: number;
  workerCount: number;
  restoreSnapshot?: string;
}>;

/** No AWS calls, lookups, plaintext secrets or committed deployment identifiers. */
export function readStageConfig(get: (key: string) => unknown): StageConfig {
  const required = (key: string) => {
    const value = get(key);
    if (typeof value !== "string" || !value.trim()) throw new Error(`AWS configuration: ${key} is required (CDK context or CRM environment)`);
    return value.trim();
  };
  const stage = required("stage");
  if (stage !== "staging" && stage !== "production") throw new Error("AWS configuration: stage must be staging or production");
  const production = stage === "production";
  const domain = required("domain");
  const validDomain = (value: string) => /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(value);
  if (!validDomain(domain)) throw new Error("AWS configuration: domain must be a DNS hostname, without protocol or path");
  const alarmEmail = required("alarmEmail");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alarmEmail)) throw new Error("AWS configuration: alarmEmail must be an email address");
  const imageSha = required("imageSha");
  if (!/^[a-f0-9]{40}$/.test(imageSha)) throw new Error("AWS configuration: imageSha must be a full lowercase git SHA");
  const region = required("region");
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)) throw new Error("AWS configuration: region is invalid");
  const account = get("account");
  if (account !== undefined && (typeof account !== "string" || !/^\d{12}$/.test(account))) throw new Error("AWS configuration: account must have 12 digits");
  const boolean = (key: string, fallback: boolean) => {
    const value = get(key);
    if (value === undefined) return fallback;
    if (![true, false, "true", "false"].includes(value as boolean | string)) throw new Error(`AWS configuration: ${key} must be true or false`);
    return value === true || value === "true";
  };
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = get(key) === undefined ? fallback : Number(get(key));
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`AWS configuration: ${key} must be ${min}–${max}`);
    return value;
  };
  const postgresVersion = required("postgresVersion");
  if (!/^(17|18)\.\d+$/.test(postgresVersion)) throw new Error("AWS configuration: postgresVersion must be an operator-verified supported 17.x or 18.x RDS version");
  const sesDomain = get("sesDomain");
  if (sesDomain !== undefined && (typeof sesDomain !== "string" || !validDomain(sesDomain))) throw new Error("AWS configuration: sesDomain must be a DNS hostname");
  const smtpHost = required("smtpHost");
  if (!validDomain(smtpHost) || /localhost|mailpit/i.test(smtpHost)) throw new Error("AWS configuration: smtpHost must be a production SMTP hostname");
  const smtpFrom = required("smtpFrom");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(smtpFrom)) throw new Error("AWS configuration: smtpFrom must be a sender email address");
  const restoreSnapshot = get("restoreSnapshot");
  if (restoreSnapshot !== undefined && (typeof restoreSnapshot !== "string" || !/^[a-z][a-z0-9-]{0,253}[a-z0-9]$/.test(restoreSnapshot))) throw new Error("AWS configuration: restoreSnapshot must be a same-account snapshot identifier");
  return Object.freeze({ stage, region, account: account as string | undefined, domain, alarmEmail, imageSha, postgresVersion,
    natGateways: integer("natGateways", production ? 2 : 1, 0, 2), multiAz: boolean("multiAz", production), waf: boolean("waf", production),
    active: boolean("active", false), sesDomain: sesDomain as string | undefined, smtpHost, smtpFrom,
    webCount: integer("webCount", production ? 2 : 1, 1, 6), workerCount: integer("workerCount", 1, 1, 4), restoreSnapshot: restoreSnapshot as string | undefined });
}
