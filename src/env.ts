import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";
import { en } from "zod/locales";

z.config(en());

export type ZodValidationIssue = {
    expected: 'string' | 'number' | 'boolean' | 'enum' | 'union' | 'intersection' | 'array' | 'object' | 'unknown' | (string & {});
    code: string;
    path: string[];
    message: string;
}

export const env = createEnv({
    server: {
        NODE_ENV: z.union([
            z.literal("development"),
            z.literal("production"),
            z.literal("test"),
        ]).default("production"),

        LOG_LEVEL: z.union([
            z.literal("fatal"),
            z.literal("error"),
            z.literal("warn"),
            z.literal("info"),
            z.literal("debug"),
            z.literal("trace"),
        ]).default("info"),

        /* ~~~ development ~~~ */

        APP_PORT: z.union([
            z.number()
                .int()
                .min(1)
                .max(65535),
            z.string()
                .regex(/^\d+$/, "Must be a valid port number")
                .transform((val) => parseInt(val, 10))
                .refine((num) => num >= 1 && num <= 65535, "Port number must be between 1 and 65535"),
        ]).default(3000),
    },

    runtimeEnv: process.env,
    emptyStringAsUndefined: true,

    onValidationError: (issues) => {
        const maxNameLength = Math.max(...issues.map((iss) => (iss as ZodValidationIssue).path.join(".").length), 0);
        console.error(`\n[ERROR] Environment variable(s) failed validation:`);
        issues.forEach((iss) => {
            const issue = iss as ZodValidationIssue;
            const name = issue.path.join(".");
            const gap = " ".repeat(maxNameLength - name.length);
            console.error(` - ${name}${gap} -> ${issue.message}`);
        });
        process.exit(1);
    }
});
