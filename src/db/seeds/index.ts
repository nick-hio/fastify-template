import { kvSeed } from "@/db/seeds/kv";
import type { Seed } from "@/db/types";

/** Seeds run in this order, so list a table before the tables that reference it. */
export const seeds: Seed[] = [kvSeed];
