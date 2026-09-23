import { closeDatabase, createDatabase } from "./client.ts";
import { seedDevelopment } from "./seed.ts";

const connectionString = process.env.DATABASE_URL ?? "postgresql://modular:modular@localhost:5432/modular_crm";
const db = createDatabase(connectionString);
try {
  await seedDevelopment(db);
  console.info("Development business data seeded. Password accounts are provisioned by the auth seed command.");
} finally {
  await closeDatabase(db);
}
