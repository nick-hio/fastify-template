import { join } from "node:path";
import { migrate as applyMigrations } from "drizzle-orm/libsql/migrator";
import type { FastifyBaseLogger } from "fastify";
import { db } from "@/db";

const MIGRATIONS_DIR = join(import.meta.dir, "../migrations");

/**
 * Applies every migration in `src/db/migrations` that the database has not recorded yet.
 * Applied migrations are tracked in the `__drizzle_migrations` table.
 */
export const migrate = async (log: FastifyBaseLogger): Promise<void> => {
    log.info("[MIGRATION] Starting migration...");
    await applyMigrations(db, { migrationsFolder: MIGRATIONS_DIR });
    log.info("[MIGRATION] Completed migration");
};
