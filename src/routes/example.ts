import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { db } from "@/db";
import { kvKeySchema, kvSchema, kvTable } from "@/db/schema/kv";

const route: FastifyPluginAsyncZod = async (fastify) => {
    fastify.get(
        "/",
        {
            schema: {
                querystring: kvKeySchema,
                response: { 200: kvSchema },
            },
        },
        async (req) => {
            const [entry] = await db.select().from(kvTable).where(eq(kvTable.key, req.query.key)).limit(1);

            if (!entry) {
                throw fastify.httpErrors.notFound("Key Not Found");
            }

            return entry;
        },
    );

    fastify.post(
        "/",
        {
            schema: {
                body: kvSchema,
                response: { 200: kvSchema },
            },
        },
        async (req) => {
            const [entry] = await db
                .insert(kvTable)
                .values(req.body)
                .onConflictDoUpdate({ target: kvTable.key, set: { value: req.body.value } })
                .returning();

            return entry;
        },
    );

    fastify.delete(
        "/",
        {
            schema: {
                querystring: kvKeySchema,
                response: { 200: kvSchema },
            },
        },
        async (req) => {
            const [entry] = await db.delete(kvTable).where(eq(kvTable.key, req.query.key)).returning();

            if (!entry) {
                throw fastify.httpErrors.notFound("Key Not Found");
            }

            return entry;
        },
    );
};

export default route;
