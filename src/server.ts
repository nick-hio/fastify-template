import Fastify from 'fastify';
import * as fs from "node:fs";
import { env } from "@/env";
import { DATA_DIR } from "@/db"
import { init } from "@/db/init";
import routes from "@/routes";
import notFoundHook from "@/hooks/not-found";

export const fastify = Fastify({
    logger: {
        level: env.LOG_LEVEL,
    }
});

if (!fs.existsSync(DATA_DIR)) {
    fastify.log.error(`Data directory does not exist: '${DATA_DIR}'`);
    process.exit(1);
}

await init(fastify.log);

/* pre-route hooks */
// fastify.register();

/* routes */
fastify.register(routes);

/* post-route hooks */
fastify.register(notFoundHook);
