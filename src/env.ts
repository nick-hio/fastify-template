import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/** `TRUST_PROXY` as a list: `"10.0.0.2, 172.16.0.0/12"` becomes `["10.0.0.2", "172.16.0.0/12"]`. */
const proxyAddresses = z
    .string()
    .transform((value) => value.split(",").map((address) => address.trim()))
    .pipe(z.array(z.union([z.ipv4(), z.cidrv4()])));

/**
 * The only place that reads `process.env`. Everything else imports `env`.
 * Keep `.env.example` and the README table in sync when adding a variable.
 */
export const env = createEnv({
    server: {
        NODE_ENV: z.enum(["development", "production", "test"]).default("production"),

        LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

        APP_HOST: z.ipv4("Must be an IPv4 address").default("0.0.0.0"),

        APP_PORT: z.coerce.number("Must be a valid port number").int().min(1).max(65535).default(3000),

        /** Directory for persistent state. Relative paths resolve from the working directory. */
        DATA_DIR: z.string().default("./data"),

        /**
         * The reverse proxies whose `X-Forwarded-*` headers are believed, as their addresses or CIDR ranges.
         * There is no `true`: it would believe the first address in `X-Forwarded-For`, which the client writes.
         */
        TRUST_PROXY: z
            .union(
                [z.literal("false").transform(() => false as const), proxyAddresses],
                "Must be a comma-separated list of IPv4 addresses and CIDR ranges, such as 127.0.0.1 or 172.16.0.0/12",
            )
            .default(false),

        /** A request that has no response after this long is answered with 503. */
        REQUEST_TIMEOUT_MS: z.coerce
            .number("Must be a positive whole number of milliseconds")
            .int()
            .positive()
            .default(30_000),

        /** On shutdown, how long to wait for open requests before the process exits anyway. */
        SHUTDOWN_TIMEOUT_MS: z.coerce
            .number("Must be a positive whole number of milliseconds")
            .int()
            .positive()
            .default(8000),
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
