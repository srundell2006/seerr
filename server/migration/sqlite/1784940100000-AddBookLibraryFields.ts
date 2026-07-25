import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookLibraryFields1784940100000 implements MigrationInterface {
  name = 'AddBookLibraryFields1784940100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable columns with no constraints, so SQLite takes a plain ADD COLUMN
    // and the table does not need rebuilding.
    await queryRunner.query(`ALTER TABLE "media" ADD "bookTitle" varchar`);
    await queryRunner.query(`ALTER TABLE "media" ADD "bookAuthor" varchar`);
    await queryRunner.query(
      `ALTER TABLE "media" ADD "bookThumbnailUrl" varchar`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_booklore_book_id" ON "media" ("bookloreBookId") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_media_booklore_book_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "media" DROP COLUMN "bookThumbnailUrl"`
    );
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "bookAuthor"`);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "bookTitle"`);
  }
}
