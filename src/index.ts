import { env } from "@/env";
import { fastify } from "@/server";

const start = async () => {
    try {
        await fastify.listen({ port: env.APP_PORT, host: "0.0.0.0" });
    } catch (err) {
        fastify.log.error("Error while starting server");
        fastify.log.error(err);
        process.exit(1);
    }
};

let isShuttingDown = false;

const shutdown = async (signal: NodeJS.Signals) => {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    fastify.log.info({ signal }, "Shutdown signal received");

    try {
        await fastify.close();
        fastify.log.info("Server closed");
        process.exit(0);
    } catch (err) {
        fastify.log.error({ err }, "Error during shutdown");
        process.exit(1);
    }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await start();
