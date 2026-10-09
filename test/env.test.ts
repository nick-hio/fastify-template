import { describe, expect, test } from "bun:test";
import { runBun } from "./helpers";

/** Loads `src/env.ts` in a process of its own, because the variables are read once, when it is imported. */
const loadEnv = async (variables: Record<string, string>) => {
    const script = 'import { env } from "@/env"; console.log(JSON.stringify({ ...env }));';
    const { exitCode, stdout, stderr } = await runBun(["-e", script], variables);

    return { exitCode, stderr, values: exitCode === 0 ? (JSON.parse(stdout) as Record<string, unknown>) : null };
};

describe("env", () => {
    test.each([
        ["false", false],
        ["true", true],
        ["10.0.0.2", ["10.0.0.2"]],
        ["10.0.0.2, 172.16.0.0/12", ["10.0.0.2", "172.16.0.0/12"]],
    ])("TRUST_PROXY=%p is read as %p", async (value, expected) => {
        const { values } = await loadEnv({ TRUST_PROXY: value });
        expect(values?.TRUST_PROXY).toEqual(expected);
    });

    test.each([
        ["APP_HOST", "localhost"],
        ["APP_HOST", "::1"],
        ["APP_PORT", "70000"],
        ["TRUST_PROXY", "nginx"],
        ["TRUST_PROXY", "10.0.0.0/40"],
        ["REQUEST_TIMEOUT_MS", "0"],
        ["SHUTDOWN_TIMEOUT_MS", "soon"],
    ])("refuses to start with %s=%p", async (name, value) => {
        const { exitCode, stderr } = await loadEnv({ [name]: value });
        expect(exitCode).toBe(1);
        expect(stderr).toContain(name);
    });
});
