import { describe, expect, test } from "bun:test";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import errorHandler from "@/plugins/error-handler";
import type { ErrorBody } from "./helpers";

const buildFailingServer = async () => {
    const fastify = Fastify();
    await fastify.register(sensible);
    await fastify.register(errorHandler);

    fastify.get("/unexpected", async () => {
        throw new Error("SQLITE_CONSTRAINT: internal detail");
    });
    fastify.get("/expected", async () => {
        throw fastify.httpErrors.conflict("Already exists");
    });

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
});
