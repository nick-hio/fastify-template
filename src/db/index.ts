import { Database } from "bun:sqlite";
import { accessSync, constants, mkdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { BUSY_TIMEOUT_MS, DATA_DIR, DATABASE_PATH } from "@/db/config";

const connect = () => {
    try {
        mkdirSync(DATA_DIR, { recursive: true });
        // SQLite also writes its journal files here, so a read-only directory only fails later, on the first write.
        accessSync(DATA_DIR, constants.W_OK);

        const client = new Database(DATABASE_PATH, { create: true, readwrite: true });

        // Write-ahead logging lets other processes, such as a backup, read while the server writes.
        client.run("PRAGMA journal_mode = WAL");
        client.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
        // SQLite does not enforce foreign keys unless each connection asks for it.
        client.run("PRAGMA foreign_keys = ON");

        return drizzle({ client });
    } catch (cause) {
        throw new Error(
            `Unable to open the database in '${DATA_DIR}'. The directory must be writable by the user running the server (uid ${process.getuid?.() ?? "unknown"}).`,
            { cause },
        );
    }
};

export const db = connect();
