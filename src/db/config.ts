import { join, resolve } from "node:path";
import { env } from "@/env";

// Imported by `drizzle.config.ts`, which drizzle-kit loads under Node.
// Keep it free of side effects and Bun-only APIs.
export const DATA_DIR = resolve(env.DATA_DIR);
export const DATABASE_URL = `file:${join(DATA_DIR, "database.db")}`;
