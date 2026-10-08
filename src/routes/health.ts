import { sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { db } from "@/db";

const route: FastifyPluginAsyncZod = async (fastify) => {
    fastify.get(
        "/",
        {
            // The container health check polls this route, so keep it out of the request log.
            logLevel: "warn",
            schema: {
                response: { 200: z.object({ status: z.literal("ok") }) },
            },
        },
        async () => {
            await db.run(sql`SELECT 1`);

            return { status: "ok" as const };
        },
    );
};

export default route;
