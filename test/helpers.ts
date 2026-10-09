import { afterAll, afterEach, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { join } from "node:path";
import { DATA_DIR } from "@/db/config";
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
 * Runs Bun with `args` in a process of its own and resolves with its exit code and output.
 * The process inherits the environment of the tests, plus `variables`, and does not load `.env` files.
 */
export const runBun = async (args: string[], variables: Record<string, string> = {}) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", ...args], {
        env: { ...process.env, ...variables },
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
 * database, and resolves once the server listens. Pass environment variables to override the defaults.
 * Every process is stopped after the test that started it.
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

        // `--no-env-file` keeps a developer's `.env` from changing what the tests observe.
        const child = Bun.spawn([process.execPath, "--no-env-file", "src/index.ts"], {
            env: {
                ...process.env,
                LOG_LEVEL: "info",
                APP_HOST: "127.0.0.1",
                APP_PORT: String(port),
                DATA_DIR: dataDir,
                ...overrides,
            },
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
