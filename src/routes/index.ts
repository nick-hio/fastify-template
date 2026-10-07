import fp from "fastify-plugin";
import exampleRoute from "@/routes/example.ts";

export default fp((fastify, _opts, done) => {
    fastify.register(exampleRoute, { prefix: '/example' });

    done();
}, { name: 'routes' });