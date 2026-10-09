import { afterAll, afterEach, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { join } from "node:path";
import { DATA_DIR } from "@/db/config";
import { env } from "@/env";
import { buildServer, type Server } from "@/server";

/** Body of every error response. See `src/plugins/error-handler.ts`. */
export interface ErrorBody {
    statusCode: number;
    error: string;
    message: string;
    /** Only present when the request failed validation. */
    issues?: { path: string; message: string }[];
}

/** One line of the server's log. */
export interface LogLine {
    msg: string;
    req?: { url: string; remoteAddress: string };
}

/**
 * Builds one server for the calling `describe` block and closes it afterwards.
 * Returns a getter, because the server only exists once `beforeAll` has run.
 */
export const useServer = () => {
    let server: Server;

    beforeAll(async () => {
        server = await buildServer();
    });

    afterAll(async () => {
        await server.close();
    });

    return () => server;
};

/**
 * The environment of a process that a test starts: the one of the test run without the variables of
 * `src/env.ts`, plus `variables`. The process therefore runs with the defaults and what the test passes,
 * whatever `test/setup.ts` or a developer's `.env`, which `bun test` loads, has set.
 *
 * A variable without a default has to be set here, next to `NODE_ENV`, or none of these processes starts.
 */
const childEnv = (variables: Record<string, string>) => {
    const inherited = { ...process.env };
    for (const name of Object.keys(env)) {
        delete inherited[name];
    }

    return { ...inherited, NODE_ENV: "test", ...variables };
};

/**
 * Runs Bun with `args` in a process of its own and resolves with its exit code and output.
 * Of the variables in `src/env.ts`, the process only sees the ones in `variables`.
 */
export const runBun = async (args: string[], variables: Record<string, string> = {}) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", ...args], {
        env: childEnv(variables),
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, child.stdout.text(), child.stderr.text()]);

    return { exitCode, stdout, stderr };
};

const freePort = () => {
    return new Promise<number>((resolve, reject) => {
        const probe = createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const { port } = probe.address() as AddressInfo;
            probe.close(() => resolve(port));
        });
    });
};

/**
 * For what `useServer()` cannot reach, because it only exists in a running process: signals, timeouts
 * and settings that are read once at startup.
 *
 * Returns a function that starts `src/index.ts` as its own process, on a free port and with its own
 * database, and resolves once the server listens. The server runs with the defaults of `src/env.ts`,
 * so pass the environment variables that the test is about. Every process is stopped after its test.
 */
export const useProcess = () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
        for (const cleanup of cleanups.splice(0)) {
            await cleanup();
        }
    });

    return async (overrides: Record<string, string> = {}) => {
        const port = await freePort();
        // inside the directory of the test run, which `test/setup.ts` removes at the end
        const dataDir = mkdtempSync(join(DATA_DIR, "process-"));

        const child = Bun.spawn([process.execPath, "--no-env-file", "src/index.ts"], {
            env: childEnv({
                LOG_LEVEL: "info",
                APP_HOST: "127.0.0.1",
                APP_PORT: String(port),
                DATA_DIR: dataDir,
                ...overrides,
            }),
            stdout: "pipe",
            stderr: "pipe",
        });

        cleanups.push(async () => {
            child.kill("SIGKILL");
            await child.exited;
        });

        let output = "";
        void (async () => {
            const decoder = new TextDecoder();
            for await (const chunk of child.stdout) {
                output += decoder.decode(chunk, { stream: true });
            }
        })();

        /** The log so far, without a last line that is still being written. */
        const logs = () => {
            const complete = output.slice(0, output.lastIndexOf("\n") + 1);
            return complete
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line) as LogLine);
        };

        /** Resolves with the first log line that matches, and rejects when the process exits without one. */
        const waitForLog = async (matches: (line: LogLine) => boolean) => {
            for (;;) {
                const line = logs().find(matches);
                if (line) {
                    return line;
                }
                if (child.exitCode !== null) {
                    throw new Error(`The server exited with code ${child.exitCode}:\n${await child.stderr.text()}`);
                }
                await Bun.sleep(10);
            }
        };

        await waitForLog((line) => line.msg.startsWith("Server listening"));

        return { child, dataDir, logs, port, url: `http://127.0.0.1:${port}`, waitForLog };
    };
};
