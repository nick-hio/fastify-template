import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { BUSY_TIMEOUT_MS, DATA_DIR, DATABASE_PATH } from "@/db/config";

/** `<DATA_DIR>/backups/database-2026-01-31T23-59-59-000Z.db`, a name that sorts by time and is valid on every OS. */
const defaultDestination = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return join(DATA_DIR, "backups", `database-${timestamp}.db`);
};

/**
 * Writes a copy of the database to `destination` and returns the path of the copy.
 *
 * Safe while the server is running: `VACUUM INTO` copies one consistent snapshot and, with write-ahead
 * logging, does not make the server wait. Copying `database.db` by hand is not safe, because the newest
 * changes are still in `database.db-wal`.
 */
export const backup = (destination = defaultDestination()): string => {
    const target = resolve(destination);

    if (!existsSync(DATABASE_PATH)) {
        throw new Error(`There is no database at '${DATABASE_PATH}'. Check DATA_DIR.`);
    }
    if (existsSync(target)) {
        throw new Error(`'${target}' already exists. A backup never overwrites a file.`);
    }
    mkdirSync(dirname(target), { recursive: true });

    // A connection of its own, so this also runs as a script next to the server or without it.
    const source = new Database(DATABASE_PATH, { readwrite: true });
    try {
        source.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
        source.query("VACUUM INTO ?").run(target);
    } finally {
        source.close();
    }

    // A backup that cannot be read is worse than none, so the copy is checked before it is reported.
    const copy = new Database(target, { readonly: true });
    try {
        const result = copy.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();

        if (result?.integrity_check !== "ok") {
            throw new Error(`The backup at '${target}' is damaged: ${result?.integrity_check}`);
        }
    } finally {
        copy.close();
    }

    return target;
};

// `bun run db:backup [destination]`
if (import.meta.main) {
    console.log(`Wrote ${backup(Bun.argv[2])}`);
}
