import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, createDatabase } from "./client.ts";

export async function migrateDatabase(connectionString: string): Promise<void> {
  const db = createDatabase(connectionString);
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  } finally {
    await closeDatabase(db);
  }
}
