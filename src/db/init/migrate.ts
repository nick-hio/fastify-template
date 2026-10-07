import * as path from 'node:path';
import { readFile, exists } from 'node:fs/promises';
import type { FastifyBaseLogger } from "fastify";
import type { Client } from "@libsql/core/api";
import { Glob } from "bun";

const findMigrationFile = async () => {
    let newest: { date?: Date, path?: string } = {};

    const migrationsDir = path.join(__dirname, '../migrations');
    const migrationsGlob = new Glob(path.join(migrationsDir, '*_init', 'migration.sql'));

    const createDate = (date: string) => new Date(
        Date.UTC(
            Number(date.slice(0, 4)), // year
            Number(date.slice(4, 6)) - 1, // month (0-based)
            Number(date.slice(6, 8)), // day
            Number(date.slice(8, 10)), // hour
            Number(date.slice(10, 12)), // minute
            Number(date.slice(12, 14)), // second
        ),
    );

    for await (const migrationFile of migrationsGlob.scan(".")) {
        const filepath = migrationFile.replaceAll('\\', '/').split('/');
        const date = createDate(filepath[filepath.length - 2]!.replace('_init', ''));

        if (!newest.date || date > newest.date) {
            newest = { date, path: migrationFile };
        }
    }

    return newest.path ?? null;
}

export const migrate = async (db: Client, log: FastifyBaseLogger): Promise<void> => {
    log.info('[MIGRATION] Starting migration...')

    const migrationFile = await findMigrationFile();
    if (!migrationFile) {
        log.error('[MIGRATION] Error: No migration file found. Exiting...');
        process.exit(1);
    }

    log.debug(`[MIGRATION] Migration file: '${migrationFile}'`)

    const fileExists = await exists(migrationFile)
    if (!fileExists) {
        log.error(`[MIGRATION] Error: Migration file does not exist. Exiting...`)
        process.exit(1);
    }

    const sqlText = await readFile(migrationFile, 'utf8')

    if (!sqlText) {
        log.debug('[MIGRATION] Migration file is empty')
    } else {
        log.debug('[MIGRATION] Executing migration statements...')
        const statements = sqlText
            .replace(/[\n\t\r`]/g, '')
            .split('--> statement-breakpoint')
            .filter(statement => statement.trim().length > 0)

        for (const statement of statements) {
            const formatted = statement.trim()
                .replace(/(CREATE TABLE)/, 'CREATE TABLE IF NOT EXISTS')
                .replace(/(CREATE UNIQUE INDEX)/, 'CREATE UNIQUE INDEX IF NOT EXISTS')

            log.debug(`[MIGRATION] -> ${formatted}`)
            await db.execute(formatted)
        }
    }

    log.info('[MIGRATION] Completed migration')
}