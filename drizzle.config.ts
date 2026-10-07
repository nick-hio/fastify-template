// https://orm.drizzle.team/docs/drizzle-config-file
import { defineConfig } from "drizzle-kit";
import { DATABASE_URL } from "@/db/config";

export default defineConfig({
    dialect: "sqlite",
    dbCredentials: { url: DATABASE_URL },
    schema: "./src/db/schema/*",
    out: "./src/db/migrations",
});
