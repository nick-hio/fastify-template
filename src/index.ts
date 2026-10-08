import { db } from "@/db";
import { env } from "@/env";
import { buildServer } from "@/server";

const fastify = await buildServer();

let isShuttingDown = false;

const shutdown = async (signal: NodeJS.Signals) => {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    fastify.log.info({ signal }, "Shutdown signal received");

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
