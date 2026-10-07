import { createClient } from '@libsql/client';
import type { FastifyBaseLogger } from "fastify";
import { connection } from "@/db";
import { migrate } from "@/db/init/migrate.ts";
import { seed } from "@/db/init/seed.ts";

export const init = async (log: FastifyBaseLogger): Promise<void> => {
    try {
        log.info('[INIT] Connecting to database...');
        const client = createClient(connection);
        log.info('[INIT] Connected to database');

        await migrate(client, log);
        await seed(client, log);

        client.close();
    } catch (e) {
        log.error('[INIT] Fatal initialization error');
        throw e;
    }

    log.info('[INIT] Completed database initialization');
}
