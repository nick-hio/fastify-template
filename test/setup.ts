import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Preloaded once per test run (see bunfig.toml), before `@/env` is first imported.
// Each run gets its own throwaway database and never touches `./data`.
const dataDir = mkdtempSync(join(tmpdir(), "fastify-template-test-"));

process.env.NODE_ENV = "test";
process.env.DATA_DIR = dataDir;
process.env.LOG_LEVEL = "silent"; // set to "debug" to see server logs while debugging a test

afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
});
