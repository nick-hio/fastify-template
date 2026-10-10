import { join } from "node:path";
import { migrate as applyMigrations } from "drizzle-orm/bun-sqlite/migrator";
import type { FastifyBaseLogger } from "fastify";
import { db } from "@/db";

const MIGRATIONS_DIR = join(import.meta.dir, "../migrations");

/**
 * Applies every migration in `src/db/migrations` that the database has not recorded yet.
 * Applied migrations are tracked in the `__drizzle_migrations` table.
 */
export const migrate = (log: FastifyBaseLogger): void => {
    log.info("[MIGRATION] Starting migration...");

    // A migration that rebuilds a table drops the old one. While foreign keys are enforced, that also deletes
    // the rows of every table that references it with ON DELETE CASCADE. The generated SQL switches the
    // pragma off itself, but SQLite ignores that inside the migrator's transaction, so it is done out here.
    db.$client.run("PRAGMA foreign_keys = OFF");
    try {
        applyMigrations(db, { migrationsFolder: MIGRATIONS_DIR });
    } finally {
        db.$client.run("PRAGMA foreign_keys = ON");
    }

    log.info("[MIGRATION] Completed migration");
};
