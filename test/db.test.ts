import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { BUSY_TIMEOUT_MS, DATABASE_PATH } from "@/db/config";
import { useServer } from "./helpers";

const pragma = (name: string) => {
    const row = db.$client.query<Record<string, unknown>, []>(`PRAGMA ${name}`).get();
    return Object.values(row ?? {})[0];
};

const names = () => db.all<{ name: string }>(sql`SELECT name FROM scratch`).map((row) => row.name);

/**
 * Starts another process that takes the write lock, adds a row and commits `holdMs` later.
 * Resolves once the lock is held.
 */
const holdWriteLock = async (holdMs: number) => {
    const script = `
        import { Database } from "bun:sqlite";
        const database = new Database(${JSON.stringify(DATABASE_PATH)});
        database.run("BEGIN IMMEDIATE");
        database.run("INSERT INTO scratch (name) VALUES ('contested')");
        console.log("locked");
        await Bun.sleep(${holdMs});
        database.run("COMMIT");
    `;
    const holder = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "inherit" });
    await holder.stdout.getReader().read();

    return holder;
};

describe("database", () => {
    // The connection is configured when it opens, and once more after the migrations that the server applies.
    useServer();

    // A table of its own, so these tests do not depend on the tables of the project.
    beforeAll(() => {
        db.run(sql`CREATE TABLE scratch (name text PRIMARY KEY NOT NULL)`);
    });

    afterAll(() => {
        db.run(sql`DROP TABLE scratch`);
    });

    beforeEach(() => {
        db.run(sql`DELETE FROM scratch`);
    });

    test("is opened with write-ahead logging, a busy timeout and foreign keys", () => {
        expect(pragma("journal_mode")).toBe("wal");
        expect(pragma("busy_timeout")).toBe(BUSY_TIMEOUT_MS);
        expect(pragma("foreign_keys")).toBe(1);
    });

    test("a write waits for another process to release the database", async () => {
        const holder = await holdWriteLock(300);

        // Without a busy timeout this throws SQLITE_BUSY at once. With it, the insert runs after the other
        // process has committed, finds the name taken and adds nothing.
        const { changes } = db.run(sql`INSERT INTO scratch (name) VALUES ('contested') ON CONFLICT DO NOTHING`);

        expect(await holder.exited).toBe(0);
        expect(changes).toBe(0);
        expect(names()).toEqual(["contested"]);
    });

    test("a transaction is rolled back as a whole when its callback throws", () => {
        const failing = () => {
            // A transaction callback is synchronous: no `async`, and `.run()`, `.get()` or `.all()` instead of `await`.
            db.transaction((tx) => {
                tx.run(sql`INSERT INTO scratch (name) VALUES ('first')`);
                tx.run(sql`INSERT INTO scratch (name) VALUES ('first')`);
            });
        };

        expect(failing).toThrow();
        expect(names()).toEqual([]);
    });
});
