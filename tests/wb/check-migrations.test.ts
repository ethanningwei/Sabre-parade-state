import { describe, expect, it } from "vitest";
import { checkMigrations, checkSql } from "@/scripts/check-migrations";

describe("check-migrations", () => {
  it("the real migrations after v1.0 only add wb_ objects", () => {
    expect(checkMigrations()).toEqual([]);
  });

  it("allows creating wb_ tables, types and indexes, and FKs from wb_ tables to v1", () => {
    const sql = `CREATE TYPE "public"."wb_role" AS ENUM('GC');--> statement-breakpoint
CREATE TABLE "wb_x" ("id" uuid PRIMARY KEY, "person_id" uuid);--> statement-breakpoint
ALTER TABLE "wb_x" ADD CONSTRAINT "wb_x_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wb_x_uq" ON "wb_x" USING btree ("person_id");`;
    expect(checkSql("ok.sql", sql)).toEqual([]);
  });

  it.each([
    [`ALTER TABLE "person" ADD COLUMN "telegram_id" text;`, /ALTER TABLE.*"person"/],
    [`ALTER TABLE IF EXISTS ONLY public.absence DROP COLUMN x;`, /ALTER TABLE.*"absence"/],
    [`DROP TABLE "duty";`, /DROP TABLE.*"duty"/],
    [`ALTER TYPE "public"."absence_type" ADD VALUE 'RSO';`, /TYPE.*"absence_type"/],
    [`DROP INDEX "absence_one_open_uq";`, /INDEX.*"absence_one_open_uq"/],
    [`CREATE INDEX "wb_sneaky" ON "person" ("name");`, /CREATE INDEX.*"person"/],
    [`CREATE TABLE "new_thing" ("id" int);`, /CREATE TABLE.*"new_thing"/],
    [`TRUNCATE "absence";`, /TRUNCATE.*"absence"/],
    [`UPDATE "camp" SET on_shift = true;`, /data change.*"camp"/],
    [`CREATE TRIGGER t AFTER INSERT ON wb_x FOR EACH ROW EXECUTE FUNCTION f();`, /trigger/],
  ])("rejects %s", (sql, reason) => {
    const v = checkSql("bad.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0].reason).toMatch(reason);
  });

  it("ignores comments", () => {
    expect(checkSql("c.sql", `-- ALTER TABLE "person" ADD x int;\nCREATE TABLE "wb_y" (id int);`)).toEqual([]);
  });
});
