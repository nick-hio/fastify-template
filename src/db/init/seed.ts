import { Glob } from "bun";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Client, InValue } from "@libsql/core/api";
import type { FastifyBaseLogger } from "fastify";
import type { Query } from "drizzle-orm/sql/sql";
import type { SeedModule } from "@/db/types.ts";

const seedDirectory = fileURLToPath(new URL("../seeds/", import.meta.url));
const seedFiles = new Glob("*.ts");

const seedTable = async (client: Client, log: FastifyBaseLogger, { name, query }: { name: string, query: Query }) => {
    if ((await client.execute(`SELECT * FROM ${name}`)).rows.length > 0) {
        log.debug(`[SEEDING] Skipping: ${name}`);
        return
    }

    try {
        await client.execute({
            sql: query.sql,
            args: query.params as InValue[],
        });
        log.debug(`[SEEDING] Seeded: ${name}`);
    } catch (error) {
        log.error(`[SEEDING] Seed Error: ${name} -> ${"message" in (error as Error) ? (error as Error).message : "Unknown error"}`);
        throw error;
    }
}

export const seed = async (
    client: Client,
    log: FastifyBaseLogger,
): Promise<void> => {
    log.info("[SEEDING] Starting seeding...");

    const filePaths: string[] = [];
    for await (const filePath of seedFiles.scan({ cwd: seedDirectory, onlyFiles: true })) {
        if (!filePath.endsWith(".d.ts")) {
            filePaths.push(filePath);
        }
    }

    for (const filePath of filePaths.sort()) {
        const moduleUrl = pathToFileURL(join(seedDirectory, filePath)).href;
        const { seed: definition } = await import(moduleUrl) as SeedModule;

        if (definition.size) {
            await seedTable(client, log, {
                name: definition.name,
                query: definition?.query(),
            });
        }
    }

    log.info("[SEEDING] Completed seeding");
}
