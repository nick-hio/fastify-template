import type { FastifyBaseLogger } from "fastify";
import { migrate } from "@/db/init/migrate";
import { seed } from "@/db/init/seed";

export const init = async (log: FastifyBaseLogger): Promise<void> => {
    try {
        migrate(log);
        await seed(log);
    } catch (e) {
        log.error("[INIT] Fatal initialization error");
        throw e;
    }

    log.info("[INIT] Completed database initialization");
};
