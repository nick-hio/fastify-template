import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { type KvEntry, kvTable } from "@/db/schema/kv";
import { type ErrorBody, useServer } from "./helpers";

describe("/example", () => {
    const server = useServer();

    beforeEach(async () => {
        await db.delete(kvTable);
    });

    test("POST stores an entry and GET returns it", async () => {
        const created = await server().inject({
            method: "POST",
            url: "/example",
            payload: { key: "greeting", value: "hello" },
        });
        expect(created.statusCode).toBe(200);
        expect(created.json<KvEntry>()).toEqual({ key: "greeting", value: "hello" });

        const fetched = await server().inject({ method: "GET", url: "/example?key=greeting" });
        expect(fetched.statusCode).toBe(200);
        expect(fetched.json<KvEntry>()).toEqual({ key: "greeting", value: "hello" });
    });

    test("POST overwrites the value of an existing key", async () => {
        await db.insert(kvTable).values({ key: "greeting", value: "hello" });

        const updated = await server().inject({
            method: "POST",
            url: "/example",
            payload: { key: "greeting", value: "goodbye" },
        });
        expect(updated.statusCode).toBe(200);
        expect(await db.select().from(kvTable)).toEqual([{ key: "greeting", value: "goodbye" }]);
    });

    test("POST trims surrounding whitespace", async () => {
        const created = await server().inject({
            method: "POST",
            url: "/example",
            payload: { key: "  greeting ", value: " hello  " },
        });
        expect(created.json<KvEntry>()).toEqual({ key: "greeting", value: "hello" });
    });

    test("DELETE removes the entry and returns it", async () => {
        await db.insert(kvTable).values({ key: "greeting", value: "hello" });

        const deleted = await server().inject({ method: "DELETE", url: "/example?key=greeting" });
        expect(deleted.statusCode).toBe(200);
        expect(deleted.json<KvEntry>()).toEqual({ key: "greeting", value: "hello" });
        expect(await db.select().from(kvTable)).toEqual([]);
    });

    test.each(["GET", "DELETE"] as const)("%s returns 404 for a key that does not exist", async (method) => {
        const response = await server().inject({ method, url: "/example?key=DOES_NOT_EXIST" });
        expect(response.statusCode).toBe(404);
        expect(response.json<ErrorBody>()).toEqual({ statusCode: 404, error: "Not Found", message: "Key Not Found" });
    });

    test.each([
        ["a missing key", { method: "GET", url: "/example" }],
        ["a blank key", { method: "GET", url: "/example?key=%20" }],
        ["a key longer than 128 characters", { method: "GET", url: `/example?key=${"k".repeat(129)}` }],
        ["a missing body", { method: "POST", url: "/example" }],
        ["a missing value", { method: "POST", url: "/example", payload: { key: "greeting" } }],
        ["a non-string value", { method: "POST", url: "/example", payload: { key: "greeting", value: 1 } }],
    ] as const)("rejects %s with 400", async (_name, request) => {
        const response = await server().inject(request);
        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorBody>()).toMatchObject({ statusCode: 400, error: "Bad Request" });
        expect(await db.select().from(kvTable)).toEqual([]);
    });
});
