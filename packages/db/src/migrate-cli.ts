import { migrateDatabase } from "./migrate.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for migrations");
await migrateDatabase(process.env.DATABASE_URL);
console.info("Database migrations applied");
