import { describe, expect, test } from "bun:test";
import { runBun } from "./helpers";

/** Loads `src/env.ts` in a process of its own, because the variables are read once, when it is imported. */
const loadEnv = async (variables: Record<string, string>) => {
    const script = 'import { env } from "@/env"; console.log(JSON.stringify({ ...env }));';
    const { exitCode, stdout, stderr } = await runBun(["-e", script], variables);

    return { exitCode, stderr, values: exitCode === 0 ? (JSON.parse(stdout) as Record<string, unknown>) : null };
};

describe("env", () => {
    test.each(["127.0.0.1", "::", "::1", "localhost"])("APP_HOST=%p is accepted", async (value) => {
        const { values } = await loadEnv({ APP_HOST: value });
        expect(values?.APP_HOST).toBe(value);
    });

    test.each([
        ["false", false],
        ["10.0.0.2", ["10.0.0.2"]],
        ["10.0.0.2, 172.16.0.0/12", ["10.0.0.2", "172.16.0.0/12"]],
        ["::1, fd00::/8", ["::1", "fd00::/8"]],
    ])("TRUST_PROXY=%p is read as %p", async (value, expected) => {
        const { values } = await loadEnv({ TRUST_PROXY: value });
        expect(values?.TRUST_PROXY).toEqual(expected);
    });

    test.each([
        ["APP_HOST", "example.com"],
        ["APP_HOST", "127.0.0"],
        ["APP_HOST", "[::1]"],
        ["APP_PORT", "70000"],
        // it would take the client address from the first entry of X-Forwarded-For, which the client writes
        ["TRUST_PROXY", "true"],
        ["TRUST_PROXY", "nginx"],
        ["TRUST_PROXY", "10.0.0.0/40"],
        ["TRUST_PROXY", "fd00::/129"],
        ["REQUEST_TIMEOUT_MS", "0"],
        ["SHUTDOWN_TIMEOUT_MS", "soon"],
    ])("refuses to start with %s=%p", async (name, value) => {
        const { exitCode, stderr } = await loadEnv({ [name]: value });
        expect(exitCode).toBe(1);
        expect(stderr).toContain(name);
    });
});
