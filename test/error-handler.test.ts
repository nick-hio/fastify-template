import { describe, expect, test } from "bun:test";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import errorHandler from "@/plugins/error-handler";
import type { ErrorBody } from "./helpers";

const buildFailingServer = async () => {
    const fastify = Fastify().withTypeProvider<ZodTypeProvider>();
    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);
    await fastify.register(sensible);
    await fastify.register(errorHandler);

    fastify.get("/unexpected", async () => {
        throw new Error("SQLITE_CONSTRAINT: internal detail");
    });
    fastify.get("/expected", async () => {
        throw fastify.httpErrors.conflict("Already exists");
    });
    fastify.post(
        "/validated",
        {
            schema: {
                body: z.object({ name: z.string(), tags: z.array(z.string()) }),
                headers: z.object({ "x-tenant": z.string() }),
            },
        },
        async () => ({}),
    );

    return fastify;
};

describe("error handler", () => {
    test("hides the message of unexpected errors", async () => {
        const fastify = await buildFailingServer();

        const response = await fastify.inject({ method: "GET", url: "/unexpected" });
        expect(response.statusCode).toBe(500);
        expect(response.json<ErrorBody>()).toEqual({
            statusCode: 500,
            error: "Internal Server Error",
            message: "Internal Server Error",
        });
    });

    test("keeps the message of client errors", async () => {
        const fastify = await buildFailingServer();

        const response = await fastify.inject({ method: "GET", url: "/expected" });
        expect(response.statusCode).toBe(409);
        expect(response.json<ErrorBody>()).toEqual({ statusCode: 409, error: "Conflict", message: "Already exists" });
    });

    test("lists every invalid field of a request as its own issue", async () => {
        const fastify = await buildFailingServer();

        const response = await fastify.inject({
            method: "POST",
            url: "/validated",
            headers: { "x-tenant": "acme" },
            payload: { name: 1, tags: ["ok", 2] },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorBody>()).toEqual({
            statusCode: 400,
            error: "Bad Request",
            message: "Invalid Request Body",
            issues: [
                { path: "name", message: "Invalid input: expected string, received number" },
                { path: "tags.1", message: "Invalid input: expected string, received number" },
            ],
        });
    });

    test("names the part of the request that is invalid", async () => {
        const fastify = await buildFailingServer();

        const response = await fastify.inject({
            method: "POST",
            url: "/validated",
            payload: { name: "a", tags: [] },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorBody>()).toMatchObject({
            message: "Invalid Request Headers",
            issues: [{ path: "x-tenant" }],
        });
    });

    test("reports a body that is not JSON without issues", async () => {
        const fastify = await buildFailingServer();

        const response = await fastify.inject({
            method: "POST",
            url: "/validated",
            headers: { "content-type": "application/json", "x-tenant": "acme" },
            payload: "{not json",
        });
        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorBody>()).toEqual({
            statusCode: 400,
            error: "Bad Request",
            message: "Body is not valid JSON but content-type is set to 'application/json'",
        });
    });
});
