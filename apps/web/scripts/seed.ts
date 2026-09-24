import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "better-auth/crypto";
import { account, createDatabase, seedDevelopment, seedUserIds } from "@modular-crm/db";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required. Copy .env.example to .env first.");

const db = createDatabase(url);
const result = await seedDevelopment(db);
const password = await hashPassword("Demo12345!");
for (const userId of Object.values(seedUserIds)) {
  await db.insert(account).values({
    id: `credential-${userId}`,
    userId,
    accountId: userId,
    providerId: "credential",
    password,
  }).onConflictDoNothing();
}
console.log(`Seeded ${Object.keys(result.actors).length} demo users across two tenants. Password: Demo12345!`);
process.exit(0);
