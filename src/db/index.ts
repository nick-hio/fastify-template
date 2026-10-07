import { join } from "path";
import { env } from "@/env.ts";
import { drizzle } from 'drizzle-orm/libsql';
import type { Config } from '@libsql/client';

export const DATA_DIR = env.NODE_ENV === 'development' || env.NODE_ENV === 'test'
    ? join(__dirname, '../../data')
    : '/data';
export const DATABASE_FILE = `file:${join(DATA_DIR, 'database.db')}`;

export const connection: Config = {
    url: DATABASE_FILE,
}

export const db = drizzle({ connection });
