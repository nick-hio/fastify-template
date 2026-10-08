import { accessSync, constants, mkdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/libsql";
import { DATA_DIR, DATABASE_URL } from "@/db/config";

const connect = () => {
    try {
        mkdirSync(DATA_DIR, { recursive: true });
        // SQLite also writes its journal files here, so a read-only directory only fails later, on the first write.
        accessSync(DATA_DIR, constants.W_OK);

        return drizzle({ connection: { url: DATABASE_URL } });
    } catch (cause) {
        throw new Error(
            `Unable to open the database in '${DATA_DIR}'. The directory must be writable by the user running the server (uid ${process.getuid?.() ?? "unknown"}).`,
            { cause },
        );
    }
};

export const db = connect();
