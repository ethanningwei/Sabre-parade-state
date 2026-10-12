import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  // v1 tables, then the whereabouts wb_ tables (additive only)
  schema: ["./lib/db/schema.ts", "./lib/wb/db/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
