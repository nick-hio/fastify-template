import type { Query } from "drizzle-orm/sql/sql";

export interface SeedDefinition {
    name: string;
    size: number;
    query: () => Query;
}

export interface SeedModule {
    seed: SeedDefinition;
}
