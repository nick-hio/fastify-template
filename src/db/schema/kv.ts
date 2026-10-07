import * as t from "drizzle-orm/sqlite-core"
import { sqliteTable } from "drizzle-orm/sqlite-core"
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const kvTable = sqliteTable("kv", {
    key: t.text().primaryKey(),
    value: t.text().notNull(),
})

export const kvSchema = createInsertSchema(kvTable);
export const kvPartialSchema = kvSchema.partial();

export type KvEntry = z.infer<typeof kvSchema>;
