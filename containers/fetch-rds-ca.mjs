// Public trust anchors, not credentials. Fail closed on download failure.
import { writeFile } from "node:fs/promises";
const response = await fetch("https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem");
if (!response.ok) throw new Error("Unable to download public RDS CA bundle");
const bundle = await response.text();
if (!bundle.includes("-----BEGIN CERTIFICATE-----") || bundle.length > 200_000) throw new Error("Invalid public RDS CA bundle");
await writeFile("containers/rds-ca.pem", bundle, { mode: 0o444 });
