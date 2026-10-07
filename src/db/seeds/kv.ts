import { db } from "@/db";
import { kvTable } from "@/db/schema/kv";
import type { KvEntry } from "@/db/schema/kv";
import type { SeedDefinition } from "@/db/types";

export const values = [] as const satisfies KvEntry[];

export const seed = {
    name: "kv",
    size: values.length,
    query: () => db.insert(kvTable).values(values).toSQL(),
} satisfies SeedDefinition;