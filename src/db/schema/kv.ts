import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-orm/zod";
import { z } from "zod";

export const kvTable = sqliteTable("kv", {
    key: text().primaryKey(),
    value: text().notNull(),
});

const boundedString = z.string().trim().min(1).max(128);

export const kvSchema = createInsertSchema(kvTable, {
    key: boundedString,
    value: boundedString,
});
export const kvKeySchema = kvSchema.pick({ key: true });

export type KvEntry = z.infer<typeof kvSchema>;
