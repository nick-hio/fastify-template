import type { FastifyInstance, HookHandlerDoneFunction } from "fastify";
import { db } from "@/db";
import { kvTable } from "@/db/schema/kv.ts";
import { eq } from "drizzle-orm";
import { StringSchema } from '@/schemas/string';

export default (fastify: FastifyInstance, _opts: {}, done: HookHandlerDoneFunction) => {
    fastify.get<{
        Querystring: {
            key: string;
        }
    }>('/', async (req, res) => {
        res.type('text/plain; charset=utf-8');

        const key = req.query['key']?.trim();
        const keyValidation = StringSchema.safeParse(key);

        if (!keyValidation.success) {
            return res.code(400).send('Invalid Key');
        }

        try {
            const result = (await db
                .select()
                .from(kvTable)
                .where(eq(kvTable.key, keyValidation.data))
                .limit(1)
            )[0]?.value ?? null;

            if (!result) {
                return res.code(400).send('Key Not Found');
            }

            return res.code(200).send(result);
        } catch (e) {
            fastify.log.error(e);
            return res.code(500).send('Internal Server Error');
        }
    });

    fastify.post<{
        Body: {
            key: string;
            value: string;
        }
    }>('/', async (req, res) => {
        res.type('text/plain; charset=utf-8');

        const key = req.body['key']?.trim();
        const keyValidation = StringSchema.safeParse(key);

        if (!keyValidation.success) {
            return res.code(400).send('Invalid Key');
        }

        const value = req.body['value']?.trim();
        const valueValidation = StringSchema.safeParse(value);

        if (!valueValidation.success) {
            return res.code(400).send('Invalid Value');
        }

        try {
            await db
                .insert(kvTable)
                .values({
                    key: keyValidation.data,
                    value: valueValidation.data,
                })
                .onConflictDoUpdate({ target: kvTable.key, set: { value: valueValidation.data } });

            return res.code(200).send(valueValidation.data);
        } catch (e) {
            fastify.log.error(e);
            return res.code(500).send('Internal Server Error');
        }
    });

    fastify.delete<{
        Querystring: {
            key: string;
        }
    }>('/', async (req, res) => {
        res.type('text/plain; charset=utf-8');

        const key = req.query['key']?.trim();
        const keyValidation = StringSchema.safeParse(key);

        if (!keyValidation.success) {
            return res.code(400).send('Invalid Key');
        }

        try {
            const result = (
                await db
                    .select()
                    .from(kvTable)
                    .where(eq(kvTable.key, keyValidation.data))
                    .limit(1)
            )[0]?.value ?? null;

            if (!result) {
                return res.code(400).send('Key Not Found');
            }

            await db
                .delete(kvTable)
                .where(eq(kvTable.key, keyValidation.data));

            return res.code(200).send(result);
        } catch (e) {
            fastify.log.error(e);
            return res.code(500).send('Internal Server Error');
        }
    });

    done();
}
