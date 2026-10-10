import { kvTable } from "@/db/schema/kv";
import type { Seed } from "@/db/types";

export const kvSeed = {
    table: kvTable,
    rows: [],
} satisfies Seed<typeof kvTable>;
