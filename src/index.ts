import { db } from "@/db";
import { env } from "@/env";
import { buildServer } from "@/server";

const fastify = await buildServer();

let isShuttingDown = false;

const shutdown = async (signal: NodeJS.Signals) => {
    if (isShuttingDown) {
        // A second signal, such as another Ctrl+C, means: stop waiting.
        fastify.log.warn({ signal }, "Second shutdown signal received, exiting now");
        db.$client.close();
        process.exit(1);
    }

    isShuttingDown = true;
    fastify.log.info({ signal }, "Shutdown signal received");

    // `close()` waits for the open requests to finish, so one that never does would keep the process alive
    // until it is killed. Queries are synchronous, so none is running when this fires and closing is safe.
    setTimeout(() => {
        fastify.log.error({ timeoutMs: env.SHUTDOWN_TIMEOUT_MS }, "Shutdown timed out with requests still open");
        db.$client.close();
        process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);

    try {
        await fastify.close();
        db.$client.close();
        fastify.log.info("Server closed");
        process.exit(0);
    } catch (err) {
        fastify.log.error({ err }, "Error during shutdown");
        process.exit(1);
    }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
    await fastify.listen({ host: env.APP_HOST, port: env.APP_PORT });
} catch (err) {
    fastify.log.error({ err }, "Error while starting server");
    process.exit(1);
}
