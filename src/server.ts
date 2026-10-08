import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { init } from "@/db/init";
import { env } from "@/env";
import errorHandler from "@/plugins/error-handler";
import routes from "@/routes";

/**
 * Builds a ready-to-use server without binding a port.
 * `src/index.ts` listens on it; tests drive it with `server.inject()`.
 */
export const buildServer = async () => {
    const fastify = Fastify({
        logger: {
            level: env.LOG_LEVEL,
        },
    }).withTypeProvider<ZodTypeProvider>();

    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);

    await init(fastify.log);

    /* plugins */
    await fastify.register(sensible);
    await fastify.register(errorHandler);

    /* routes */
    await fastify.register(routes);

    await fastify.ready();

    return fastify;
};

export type Server = Awaited<ReturnType<typeof buildServer>>;
