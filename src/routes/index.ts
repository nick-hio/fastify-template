import type { FastifyPluginAsync } from "fastify";
import exampleRoute from "@/routes/example";
import healthRoute from "@/routes/health";

const routes: FastifyPluginAsync = async (fastify) => {
    await fastify.register(healthRoute, { prefix: "/health" });
    await fastify.register(exampleRoute, { prefix: "/example" });
};

export default routes;
