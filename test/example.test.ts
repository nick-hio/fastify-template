import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { type KvEntry, kvTable } from "@/db/schema/kv";
import { type ErrorBody, useServer } from "./helpers";

interface KvPage {
    items: KvEntry[];
    nextCursor: number | null;
}

describe("/example", () => {
    const server = useServer();

    beforeEach(async () => {
        await db.delete(kvTable);
    });

    const insert = async (key: string, value = "hello") => {
        const [entry] = await db.insert(kvTable).values({ key, value }).returning();
        return entry as KvEntry;
    };

    test("POST creates an entry with a generated id and timestamp", async () => {
        const before = Date.now();

        const created = await server().inject({
            method: "POST",
            url: "/example",
            payload: { key: "greeting", value: "hello" },
        });
        expect(created.statusCode).toBe(201);

        const entry = created.json<KvEntry>();
        expect(entry).toEqual({
            id: expect.any(Number),
            key: "greeting",
            value: "hello",
            createdAt: expect.any(String),
        });
        // generous bounds: the database rounds its clock to the millisecond on its own
        expect(Date.parse(entry.createdAt)).toBeWithin(before - 1000, Date.now() + 1000);
        expect(await db.select().from(kvTable)).toEqual([entry]);
    });

    test("POST trims surrounding whitespace", async () => {
        const created = await server().inject({
            method: "POST",
            url: "/example",
            payload: { key: "  greeting ", value: " hello  " },
        });
        expect(created.json<KvEntry>()).toMatchObject({ key: "greeting", value: "hello" });
    });

    test("POST ignores fields that the database generates", async () => {
        const created = await server().inject({
            method: "POST",
            url: "/example",
            payload: { key: "greeting", value: "hello", id: 999, createdAt: "2000-01-01T00:00:00.000Z" },
        });
        expect(created.statusCode).toBe(201);

        const entry = created.json<KvEntry>();
        expect(entry.id).not.toBe(999);
        expect(entry.createdAt).not.toBe("2000-01-01T00:00:00.000Z");
    });

    test("POST returns 409 for a key that already exists", async () => {
        const existing = await insert("greeting");

        const response = await server().inject({
            method: "POST",
            url: "/example",
            payload: { key: "greeting", value: "goodbye" },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json<ErrorBody>()).toEqual({
            statusCode: 409,
            error: "Conflict",
            message: "Key Already Exists",
        });
        expect(await db.select().from(kvTable)).toEqual([existing]);
    });

    test("the database refuses an entry without a key, also when it is written with plain SQL", () => {
        expect(() => db.$client.run("INSERT INTO kv (key, value) VALUES (NULL, 'orphan')")).toThrow("NOT NULL");
    });

    test("GET /:id returns the entry", async () => {
        const existing = await insert("greeting");

        const response = await server().inject({ method: "GET", url: `/example/${existing.id}` });
        expect(response.statusCode).toBe(200);
        expect(response.json<KvEntry>()).toEqual(existing);
    });

    test("PATCH /:id changes the value and nothing else", async () => {
        const existing = await insert("greeting");

        const response = await server().inject({
            method: "PATCH",
            url: `/example/${existing.id}`,
            payload: { value: "goodbye", key: "ignored" },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json<KvEntry>()).toEqual({ ...existing, value: "goodbye" });
        expect(await db.select().from(kvTable)).toEqual([{ ...existing, value: "goodbye" }]);
    });

    test("DELETE /:id removes the entry and returns no content", async () => {
        const existing = await insert("greeting");

        const response = await server().inject({ method: "DELETE", url: `/example/${existing.id}` });
        expect(response.statusCode).toBe(204);
        expect(response.body).toBe("");
        expect(await db.select().from(kvTable)).toEqual([]);
    });

    test.each([
        ["GET", undefined],
        ["PATCH", { value: "goodbye" }],
        ["DELETE", undefined],
    ] as const)("%s /:id returns 404 for an id that does not exist", async (method, payload) => {
        const response = await server().inject({ method, url: "/example/999999", payload });
        expect(response.statusCode).toBe(404);
        expect(response.json<ErrorBody>()).toEqual({
            statusCode: 404,
            error: "Not Found",
            message: "Entry Not Found",
        });
    });

    test("GET lists the entries in pages that follow each other", async () => {
        const a = await insert("a");
        const b = await insert("b");
        const c = await insert("c");

        const first = await server().inject({ method: "GET", url: "/example?limit=2" });
        expect(first.statusCode).toBe(200);
        expect(first.json<KvPage>()).toEqual({ items: [a, b], nextCursor: b.id });

        const second = await server().inject({ method: "GET", url: `/example?limit=2&cursor=${b.id}` });
        expect(second.json<KvPage>()).toEqual({ items: [c], nextCursor: null });
    });

    test("GET returns one page with every entry when they fit the default limit", async () => {
        const entries = [await insert("a"), await insert("b")];

        const response = await server().inject({ method: "GET", url: "/example" });
        expect(response.json<KvPage>()).toEqual({ items: entries, nextCursor: null });
    });

    test("GET does not announce another page when the last one is exactly full", async () => {
        const entries = [await insert("a"), await insert("b")];

        const response = await server().inject({ method: "GET", url: "/example?limit=2" });
        expect(response.json<KvPage>()).toEqual({ items: entries, nextCursor: null });
    });

    test.each([
        ["a limit of 0", { method: "GET", url: "/example?limit=0" }, "Invalid Query String", "limit"],
        ["a limit above 100", { method: "GET", url: "/example?limit=101" }, "Invalid Query String", "limit"],
        [
            "a cursor that is not a number",
            { method: "GET", url: "/example?cursor=abc" },
            "Invalid Query String",
            "cursor",
        ],
        ["an id that is not a number", { method: "GET", url: "/example/abc" }, "Invalid Path Parameters", "id"],
        ["an id of 0", { method: "DELETE", url: "/example/0" }, "Invalid Path Parameters", "id"],
        ["a missing body", { method: "POST", url: "/example" }, "Invalid Request Body", ""],
        [
            "a missing value",
            { method: "POST", url: "/example", payload: { key: "a" } },
            "Invalid Request Body",
            "value",
        ],
        [
            "a blank key",
            { method: "POST", url: "/example", payload: { key: " ", value: "b" } },
            "Invalid Request Body",
            "key",
        ],
        [
            "a key longer than 128 characters",
            { method: "POST", url: "/example", payload: { key: "k".repeat(129), value: "b" } },
            "Invalid Request Body",
            "key",
        ],
        [
            "a non-string value",
            { method: "PATCH", url: "/example/1", payload: { value: 1 } },
            "Invalid Request Body",
            "value",
        ],
    ] as const)("rejects %s with 400", async (_name, request, message, path) => {
        const response = await server().inject(request);
        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorBody>()).toEqual({
            statusCode: 400,
            error: "Bad Request",
            message,
            issues: [{ path, message: expect.any(String) }],
        });
        expect(await db.select().from(kvTable)).toEqual([]);
    });
});
