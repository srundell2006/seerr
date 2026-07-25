import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookLibraryFields1784940000000 implements MigrationInterface {
  name = 'AddBookLibraryFields1784940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media" ADD "bookTitle" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "media" ADD "bookAuthor" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "media" ADD "bookThumbnailUrl" character varying`
    );
    // The library sync matches on this first, so it needs an index.
    await queryRunner.query(
      `CREATE INDEX "IDX_media_booklore_book_id" ON "media" ("bookloreBookId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_media_booklore_book_id"`);
    await queryRunner.query(
      `ALTER TABLE "media" DROP COLUMN "bookThumbnailUrl"`
    );
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "bookAuthor"`);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "bookTitle"`);
  }
}
