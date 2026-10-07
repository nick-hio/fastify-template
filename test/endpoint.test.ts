import { describe, expect, test } from "bun:test";
import { fastify } from "@/server";
import { DEFAULT_TEST_REQUEST } from "./helpers";

describe("example tests", () => {
    test("Returns 400 message for non-existent key", async () => {
        const response = await fastify.inject({
            ...DEFAULT_TEST_REQUEST,
            url: '/credential?key=DOES_NOT_EXIST',
        });
        expect(response.body).toBe('Key Not Found');
        expect(response.statusCode).toBe(400);
    });
});
