import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookMediaSupport1784930000000 implements MigrationInterface {
  name = 'AddBookMediaSupport1784930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Manually added: books have no TMDB identity, so tmdbId can no longer
    // carry NOT NULL. Movie and TV rows still always populate it.
    await queryRunner.query(
      `ALTER TABLE "media" ALTER COLUMN "tmdbId" DROP NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "media" ADD "isbn13" character varying`
    );
    await queryRunner.query(`ALTER TABLE "media" ADD "asin" character varying`);
    await queryRunner.query(
      `ALTER TABLE "media" ADD "bookloreWantedBookId" integer`
    );
    await queryRunner.query(`ALTER TABLE "media" ADD "bookloreBookId" integer`);
    await queryRunner.query(
      `CREATE INDEX "IDX_media_isbn13" ON "media" ("isbn13")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_asin" ON "media" ("asin")`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "bookTitle" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "bookAuthor" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "bookFormat" character varying`
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
    await queryRunner.query(`DROP INDEX "IDX_media_asin"`);
    await queryRunner.query(`DROP INDEX "IDX_media_isbn13"`);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "bookloreBookId"`);
    await queryRunner.query(
      `ALTER TABLE "media" DROP COLUMN "bookloreWantedBookId"`
    );
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "asin"`);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "isbn13"`);
    // Manually added: restoring NOT NULL is impossible while book rows exist,
    // since those are precisely the rows with a null tmdbId. Dropping them is
    // the only way back to the old shape.
    await queryRunner.query(`DELETE FROM "media" WHERE "tmdbId" IS NULL`);
    await queryRunner.query(
      `ALTER TABLE "media" ALTER COLUMN "tmdbId" SET NOT NULL`
    );
  }
}
