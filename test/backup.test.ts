import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { backup } from "@/db/backup";
import { DATA_DIR } from "@/db/config";
import { runBun, useProcess, useServer } from "./helpers";

describe("backup", () => {
    useServer();

    // A table of its own, so these tests do not depend on the tables of the project.
    beforeAll(() => {
        db.run(sql`CREATE TABLE backup_scratch (note text NOT NULL)`);
    });

    afterAll(() => {
        db.run(sql`DROP TABLE backup_scratch`);
    });

    test("writes a copy that keeps the data when the database changes afterwards", () => {
        db.run(sql`INSERT INTO backup_scratch (note) VALUES ('keep me')`);

        const path = backup(join(DATA_DIR, "backups", "copy.db"));
        db.run(sql`DELETE FROM backup_scratch`);

        const copy = new Database(path, { readonly: true });
        expect(copy.query("SELECT note FROM backup_scratch").all()).toEqual([{ note: "keep me" }]);
        copy.close();
    });

    test("names the copy after the current time when no destination is given", () => {
        expect(backup()).toMatch(/backups[/\\]database-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/);
    });

    test("does not overwrite an existing file", () => {
        const path = backup(join(DATA_DIR, "backups", "once.db"));

        expect(() => backup(path)).toThrow("already exists");
    });
});

// The steps from "Backup and restore" in the README, against a real server.
describe("backup and restore", () => {
    const start = useProcess();

    test("a backup taken while the server runs can be restored", async () => {
        const server = await start();
        const databasePath = join(server.dataDir, "database.db");

        // another process writing to the database of a running server, as a job or a script would
        const writer = new Database(databasePath);
        writer.run("CREATE TABLE scratch (note text NOT NULL)");
        writer.run("INSERT INTO scratch (note) VALUES ('keep me')");

        // `bun run db:backup`
        const script = await runBun(["src/db/backup.ts"], { DATA_DIR: server.dataDir });
        expect(script.exitCode).toBe(0);
        const backupPath = script.stdout.trim().replace("Wrote ", "");

        // lose the data, then stop the server
        writer.run("DELETE FROM scratch");
        writer.close();
        server.child.kill("SIGTERM");
        expect(await server.child.exited).toBe(0);

        // restore: put the backup in place of the database and remove what is left of its write-ahead log
        copyFileSync(backupPath, databasePath);
        rmSync(`${databasePath}-wal`, { force: true });
        rmSync(`${databasePath}-shm`, { force: true });

        const restored = await start({ DATA_DIR: server.dataDir });
        expect((await fetch(`${restored.url}/health`)).status).toBe(200);

        const reader = new Database(databasePath, { readonly: true });
        expect(reader.query("SELECT note FROM scratch").all()).toEqual([{ note: "keep me" }]);
        reader.close();
    });
});
