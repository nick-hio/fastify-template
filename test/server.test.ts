import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildServer } from "@/server";
import { type ErrorBody, useServer } from "./helpers";

const countAppliedMigrations = async () => {
    const [row] = await db.all<{ count: number }>(sql`SELECT count(*) AS count FROM __drizzle_migrations`);
    return row?.count ?? 0;
};

describe("server", () => {
    const server = useServer();

    test("GET /health reports ok", async () => {
        const response = await server().inject({ method: "GET", url: "/health" });
        expect(response.statusCode).toBe(200);
        expect(response.json<{ status: string }>()).toEqual({ status: "ok" });
    });

    test("unknown routes return a JSON 404", async () => {
        const response = await server().inject({ method: "GET", url: "/does-not-exist" });
        expect(response.statusCode).toBe(404);
        expect(response.json<ErrorBody>()).toMatchObject({ statusCode: 404, error: "Not Found" });
    });

    test("building the server again does not re-apply migrations", async () => {
        const before = await countAppliedMigrations();

        const second = await buildServer();
        await second.close();

        expect(before).toBeGreaterThan(0);
        expect(await countAppliedMigrations()).toBe(before);
    });
});
