import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookMediaSupport1784930100000 implements MigrationInterface {
  name = 'AddBookMediaSupport1784930100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SQLite cannot drop NOT NULL in place, so the whole table is rebuilt:
    // drop the indexes, create temporary_media with the new shape, copy,
    // swap, then recreate every index that existed plus the two new ones.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_7157aad07c73f6a6ae3bbd5ef5"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_41a289eb1fa489c1bc6f38d9c3"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_7ff2d11f6a83cb52386eaebe74"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_c730c2d67f271a372c39a07b7e"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_5d6218de4f547909391a5c1347"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_f8233358694d1677a67899b90a"`
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_media" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "tmdbId" integer, "tvdbId" integer, "imdbId" varchar, "status" integer NOT NULL DEFAULT (1), "status4k" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "lastSeasonChange" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaAddedAt" datetime DEFAULT (CURRENT_TIMESTAMP), "serviceId" integer, "serviceId4k" integer, "externalServiceId" integer, "externalServiceId4k" integer, "externalServiceSlug" varchar, "externalServiceSlug4k" varchar, "ratingKey" varchar, "ratingKey4k" varchar, "jellyfinMediaId" varchar, "jellyfinMediaId4k" varchar, "isbn13" varchar, "asin" varchar, "bookloreWantedBookId" integer, "bookloreBookId" integer, CONSTRAINT "UQ_41a289eb1fa489c1bc6f38d9c3c" UNIQUE ("tvdbId"))`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_media"("id", "mediaType", "tmdbId", "tvdbId", "imdbId", "status", "status4k", "createdAt", "updatedAt", "lastSeasonChange", "mediaAddedAt", "serviceId", "serviceId4k", "externalServiceId", "externalServiceId4k", "externalServiceSlug", "externalServiceSlug4k", "ratingKey", "ratingKey4k", "jellyfinMediaId", "jellyfinMediaId4k") SELECT "id", "mediaType", "tmdbId", "tvdbId", "imdbId", "status", "status4k", "createdAt", "updatedAt", "lastSeasonChange", "mediaAddedAt", "serviceId", "serviceId4k", "externalServiceId", "externalServiceId4k", "externalServiceSlug", "externalServiceSlug4k", "ratingKey", "ratingKey4k", "jellyfinMediaId", "jellyfinMediaId4k" FROM "media"`
    );
    await queryRunner.query(`DROP TABLE "media"`);
    await queryRunner.query(`ALTER TABLE "temporary_media" RENAME TO "media"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_7157aad07c73f6a6ae3bbd5ef5" ON "media" ("tmdbId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_41a289eb1fa489c1bc6f38d9c3" ON "media" ("tvdbId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7ff2d11f6a83cb52386eaebe74" ON "media" ("imdbId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c730c2d67f271a372c39a07b7e" ON "media" ("status") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d6218de4f547909391a5c1347" ON "media" ("status4k") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f8233358694d1677a67899b90a" ON "media" ("tmdbId", "mediaType") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_isbn13" ON "media" ("isbn13") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_asin" ON "media" ("asin") `
    );
    // Plain ADD COLUMN is safe here: these are nullable and add no constraint,
    // so SQLite does not need the table rebuilt.
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "bookTitle" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "bookAuthor" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "bookFormat" varchar`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP COLUMN "bookFormat"`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP COLUMN "bookAuthor"`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP COLUMN "bookTitle"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_media_asin"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_media_isbn13"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_f8233358694d1677a67899b90a"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_5d6218de4f547909391a5c1347"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_c730c2d67f271a372c39a07b7e"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_7ff2d11f6a83cb52386eaebe74"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_41a289eb1fa489c1bc6f38d9c3"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_7157aad07c73f6a6ae3bbd5ef5"`
    );
    // Book rows are exactly the rows with a null tmdbId, so they cannot
    // survive a return to the NOT NULL shape.
    await queryRunner.query(`DELETE FROM "media" WHERE "tmdbId" IS NULL`);
    await queryRunner.query(
      `CREATE TABLE "temporary_media" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "tmdbId" integer NOT NULL, "tvdbId" integer, "imdbId" varchar, "status" integer NOT NULL DEFAULT (1), "status4k" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "lastSeasonChange" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaAddedAt" datetime DEFAULT (CURRENT_TIMESTAMP), "serviceId" integer, "serviceId4k" integer, "externalServiceId" integer, "externalServiceId4k" integer, "externalServiceSlug" varchar, "externalServiceSlug4k" varchar, "ratingKey" varchar, "ratingKey4k" varchar, "jellyfinMediaId" varchar, "jellyfinMediaId4k" varchar, CONSTRAINT "UQ_41a289eb1fa489c1bc6f38d9c3c" UNIQUE ("tvdbId"))`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_media"("id", "mediaType", "tmdbId", "tvdbId", "imdbId", "status", "status4k", "createdAt", "updatedAt", "lastSeasonChange", "mediaAddedAt", "serviceId", "serviceId4k", "externalServiceId", "externalServiceId4k", "externalServiceSlug", "externalServiceSlug4k", "ratingKey", "ratingKey4k", "jellyfinMediaId", "jellyfinMediaId4k") SELECT "id", "mediaType", "tmdbId", "tvdbId", "imdbId", "status", "status4k", "createdAt", "updatedAt", "lastSeasonChange", "mediaAddedAt", "serviceId", "serviceId4k", "externalServiceId", "externalServiceId4k", "externalServiceSlug", "externalServiceSlug4k", "ratingKey", "ratingKey4k", "jellyfinMediaId", "jellyfinMediaId4k" FROM "media"`
    );
    await queryRunner.query(`DROP TABLE "media"`);
    await queryRunner.query(`ALTER TABLE "temporary_media" RENAME TO "media"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_7157aad07c73f6a6ae3bbd5ef5" ON "media" ("tmdbId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_41a289eb1fa489c1bc6f38d9c3" ON "media" ("tvdbId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7ff2d11f6a83cb52386eaebe74" ON "media" ("imdbId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c730c2d67f271a372c39a07b7e" ON "media" ("status") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d6218de4f547909391a5c1347" ON "media" ("status4k") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f8233358694d1677a67899b90a" ON "media" ("tmdbId", "mediaType") `
    );
  }
}
