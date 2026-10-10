import { getTableName, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { db } from "@/db";
import { seeds } from "@/db/seeds";

/** Inserts each seed's rows, but only into tables that are still empty. */
export const seed = async (log: FastifyBaseLogger): Promise<void> => {
    log.info("[SEEDING] Starting seeding...");

    for (const { table, rows } of seeds) {
        const name = getTableName(table);
        const [existing] = await db.select({ exists: sql`1` }).from(table).limit(1);

        if (rows.length === 0 || existing) {
            log.debug(`[SEEDING] Skipping: ${name}`);
            continue;
        }

        await db.insert(table).values(rows);
        log.debug(`[SEEDING] Seeded: ${name}`);
    }

    log.info("[SEEDING] Completed seeding");
};
