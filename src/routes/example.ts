import { eq, gt } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { db } from "@/db";
import { kvCreateSchema, kvSchema, kvTable, kvUpdateSchema } from "@/db/schema/kv";

// Path parameters and query strings arrive as strings, so numbers are coerced.
const paramsSchema = z.object({
    id: z.coerce.number().int().positive(),
});

const listQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    /** The `nextCursor` of the previous page. Leave it out to get the first page. */
    cursor: z.coerce.number().int().positive().optional(),
});

const listSchema = z.object({
    items: z.array(kvSchema),
    /** Pass this as `cursor` to get the next page. `null` on the last page. */
    nextCursor: z.number().int().nullable(),
});

const route: FastifyPluginAsyncZod = async (fastify) => {
    fastify.get(
        "/",
        {
            schema: {
                querystring: listQuerySchema,
                response: { 200: listSchema },
            },
        },
        async (req) => {
            const { limit, cursor } = req.query;

            // Entries are paged by `id` instead of by offset, so a page stays the same while rows are added or
            // removed. One row more than the page holds is read, to learn whether another page follows.
            const rows = await db
                .select()
                .from(kvTable)
                .where(cursor ? gt(kvTable.id, cursor) : undefined)
                .orderBy(kvTable.id)
                .limit(limit + 1);
            const items = rows.slice(0, limit);

            return {
                items,
                nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
            };
        },
    );

    fastify.post(
        "/",
        {
            schema: {
                body: kvCreateSchema,
                response: { 201: kvSchema },
            },
        },
        async (req, reply) => {
            // One statement, so two requests that create the same key at the same time cannot both succeed.
            const [entry] = await db.insert(kvTable).values(req.body).onConflictDoNothing().returning();

            if (!entry) {
                throw fastify.httpErrors.conflict("Key Already Exists");
            }

            return reply.code(201).send(entry);
        },
    );

    fastify.get(
        "/:id",
        {
            schema: {
                params: paramsSchema,
                response: { 200: kvSchema },
            },
        },
        async (req) => {
            const [entry] = await db.select().from(kvTable).where(eq(kvTable.id, req.params.id)).limit(1);

            if (!entry) {
                throw fastify.httpErrors.notFound("Entry Not Found");
            }

            return entry;
        },
    );

    fastify.patch(
        "/:id",
        {
            schema: {
                params: paramsSchema,
                body: kvUpdateSchema,
                response: { 200: kvSchema },
            },
        },
        async (req) => {
            const [entry] = await db.update(kvTable).set(req.body).where(eq(kvTable.id, req.params.id)).returning();

            if (!entry) {
                throw fastify.httpErrors.notFound("Entry Not Found");
            }

            return entry;
        },
    );

    fastify.delete(
        "/:id",
        {
            schema: {
                params: paramsSchema,
                response: { 204: z.null() },
            },
        },
        async (req, reply) => {
            const [entry] = await db.delete(kvTable).where(eq(kvTable.id, req.params.id)).returning();

            if (!entry) {
                throw fastify.httpErrors.notFound("Entry Not Found");
            }

            return reply.code(204).send(null);
        },
    );
};

export default route;
