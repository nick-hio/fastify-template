import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";

export const kvTable = sqliteTable("kv", {
    id: integer().primaryKey({ autoIncrement: true }),
    key: text().notNull().unique(),
    value: text().notNull(),
    // Set by the database: an ISO 8601 timestamp in UTC, the format of `Date.prototype.toISOString()`.
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

const boundedString = z.string().trim().min(1).max(128);

/** A stored entry, as the API returns it. */
export const kvSchema = createSelectSchema(kvTable, {
    createdAt: z.iso.datetime(),
});

/** What a client sends to create an entry. The database generates `id` and `createdAt`. */
export const kvCreateSchema = createInsertSchema(kvTable, {
    key: boundedString,
    value: boundedString,
}).pick({ key: true, value: true });

/** What a client sends to change an entry. The key of an entry never changes. */
export const kvUpdateSchema = kvCreateSchema.pick({ value: true });

export type KvEntry = z.infer<typeof kvSchema>;
