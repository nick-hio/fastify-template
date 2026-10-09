import { join, resolve } from "node:path";
import { env } from "@/env";

// Imported by `drizzle.config.ts`, which drizzle-kit loads on its own.
// Keep it free of side effects.
export const DATA_DIR = resolve(env.DATA_DIR);

// A plain path, not a `file:` URL, so a directory name with `#`, `?` or `%` in it needs no escaping.
export const DATABASE_PATH = join(DATA_DIR, "database.db");

/** How long a write waits for another process to release the database lock, instead of failing at once. */
export const BUSY_TIMEOUT_MS = 5000;
