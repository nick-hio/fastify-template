// https://orm.drizzle.team/docs/drizzle-config-file#driver
import { defineConfig } from "drizzle-kit";
import { DATABASE_FILE } from "@/db";

export default defineConfig({
    dialect: "sqlite",
    dbCredentials: { url: DATABASE_FILE },
    schema: "./src/db/schema/*",
    out: "./src/db/migrations",
});
