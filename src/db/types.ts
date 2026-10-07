import type { InferInsertModel } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/** Default rows for one table. They are inserted at startup only while the table is empty. */
export interface Seed<T extends SQLiteTable = SQLiteTable> {
    table: T;
    rows: InferInsertModel<T>[];
}
