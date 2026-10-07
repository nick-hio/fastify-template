import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * The only place that reads `process.env`. Everything else imports `env`.
 * Keep `.env.example` and the README table in sync when adding a variable.
 */
export const env = createEnv({
    server: {
        NODE_ENV: z.enum(["development", "production", "test"]).default("production"),

        LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

        APP_HOST: z.string().default("0.0.0.0"),

        APP_PORT: z.coerce.number("Must be a valid port number").int().min(1).max(65535).default(3000),

        /** Directory for persistent state. Relative paths resolve from the working directory. */
        DATA_DIR: z.string().default("./data"),

        /** Enable only when every request arrives through a reverse proxy that sets the client IP headers. */
        TRUST_PROXY: z.stringbool().default(false),
    },

    runtimeEnv: process.env,
    emptyStringAsUndefined: true,

    onValidationError: (issues) => {
        const rows = issues.map((issue) => ({
            name: (issue.path ?? []).map((segment) => (typeof segment === "object" ? segment.key : segment)).join("."),
            message: issue.message,
        }));
        const maxNameLength = Math.max(...rows.map((row) => row.name.length), 0);

        console.error("\n[ERROR] Environment variable(s) failed validation:");
        for (const row of rows) {
            console.error(` - ${row.name.padEnd(maxNameLength)} -> ${row.message}`);
        }
        process.exit(1);
    },
});
