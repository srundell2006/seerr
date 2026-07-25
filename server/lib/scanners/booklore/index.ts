import type { BookLoreBook } from '@server/api/booklore';
import { getBookLoreClient } from '@server/api/booklore';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type {
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import logger from '@server/logger';
import { In } from 'typeorm';

/** Rows per INSERT / UPDATE statement. */
const WRITE_CHUNK = 500;

/** Only these fields are read back; the rest of Media is irrelevant here. */
interface ExistingBook {
  id: number;
  bookloreBookId: number | null;
  isbn13: string | null;
  asin: string | null;
  bookTitle: string | null;
  bookAuthor: string | null;
  bookThumbnailUrl: string | null;
  status: number;
}

/** BookLore's Book DTO reduced to what the sync actually stores. */
interface SlimBook {
  bookloreBookId: number;
  isbn13?: string;
  asin?: string;
  bookTitle?: string;
  bookAuthor?: string;
  bookThumbnailUrl?: string;
}

/**
 * Mirrors BookLore's library into Seerr's Media table, the way the Plex and
 * Jellyfin scanners mirror those libraries.
 *
 * Without this, Seerr only knows about books somebody explicitly requested, so
 * a book already on the shelf would still look requestable. BookLore's lookup
 * does return an `inLibrary` flag, but it costs ~46s because it fans out over
 * twelve metadata providers — far too slow to answer "do we have this" per
 * render. Syncing on a schedule and reading Seerr's own table makes it free.
 *
 * Written for real scale. The measured library is 140,482 books in a single
 * 139 MB unpaged response (BookLore's /books takes no paging parameters), so
 * this does exactly one read of existing rows, diffs in memory, and writes in
 * chunks. A naive per-book lookup-then-save would issue over half a million
 * queries against Postgres on every scan.
 */
class BookLoreScanner implements RunnableScanner<StatusBase> {
  private running = false;
  private progress = 0;
  private total = 0;

  public status(): StatusBase {
    return {
      running: this.running,
      progress: this.progress,
      total: this.total,
    };
  }

  public cancel(): void {
    this.running = false;
    this.progress = 0;
    this.total = 0;
  }

  public async run(): Promise<void> {
    if (this.running) {
      logger.info('BookLore library scan already running, skipping', {
        label: 'BookLore Scan',
      });
      return;
    }

    const booklore = getBookLoreClient();

    if (!booklore) {
      return;
    }

    this.running = true;
    this.progress = 0;
    this.total = 0;

    try {
      logger.info('BookLore library scan starting', { label: 'BookLore Scan' });

      const books = this.slim(await booklore.getBooks());
      this.total = books.length;

      logger.info(`Read ${books.length} book(s) from BookLore`, {
        label: 'BookLore Scan',
      });

      const existing = await this.loadExisting();
      const { inserts, updates } = this.diff(books, existing);

      await this.insertAll(inserts);
      await this.updateAll(updates);
      const removed = await this.markRemoved(books, existing);

      this.progress = books.length;

      logger.info(
        `BookLore library scan complete: ${inserts.length} added, ${updates.length} updated, ${removed} removed`,
        { label: 'BookLore Scan' }
      );
    } catch (e) {
      logger.error('BookLore library scan failed', {
        label: 'BookLore Scan',
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.running = false;
    }
  }

  /**
   * Projects the full DTOs down immediately so the heavy parsed response can
   * be collected rather than held for the length of the scan.
   */
  private slim(books: BookLoreBook[]): SlimBook[] {
    return books.map((book) => {
      const metadata = book.metadata ?? {};

      return {
        bookloreBookId: book.id,
        isbn13: metadata.isbn13 ?? undefined,
        asin: metadata.asin ?? undefined,
        bookTitle: metadata.title ?? book.title ?? undefined,
        bookAuthor: metadata.authors?.join(', ') || undefined,
        bookThumbnailUrl: metadata.thumbnailUrl ?? undefined,
      };
    });
  }

  private async loadExisting(): Promise<ExistingBook[]> {
    return getRepository(Media)
      .createQueryBuilder('media')
      .select([
        'media.id',
        'media.bookloreBookId',
        'media.isbn13',
        'media.asin',
        'media.bookTitle',
        'media.bookAuthor',
        'media.bookThumbnailUrl',
        'media.status',
      ])
      .where('media.mediaType = :mediaType', { mediaType: MediaType.BOOK })
      .getRawMany()
      .then((rows) =>
        rows.map((row) => ({
          id: row.media_id,
          bookloreBookId: row.media_bookloreBookId,
          isbn13: row.media_isbn13,
          asin: row.media_asin,
          bookTitle: row.media_bookTitle,
          bookAuthor: row.media_bookAuthor,
          bookThumbnailUrl: row.media_bookThumbnailUrl,
          status: row.media_status,
        }))
      );
  }

  /**
   * Resolves each BookLore book against what Seerr already has and splits the
   * work into new rows and genuinely-changed rows.
   *
   * Matching order is bookloreBookId, then ASIN, then ISBN. The id is the only
   * stable identifier; ASIN comes before ISBN because an audiobook and its
   * ebook edition share a title but never an ASIN, so matching ISBN first
   * would silently collapse the two formats into one row.
   */
  private diff(
    books: SlimBook[],
    existing: ExistingBook[]
  ): { inserts: SlimBook[]; updates: (SlimBook & { id: number })[] } {
    const byBookId = new Map<number, ExistingBook>();
    const byAsin = new Map<string, ExistingBook>();
    const byIsbn = new Map<string, ExistingBook>();

    for (const row of existing) {
      if (row.bookloreBookId != null) {
        byBookId.set(row.bookloreBookId, row);
      }
      if (row.asin) {
        byAsin.set(row.asin, row);
      }
      if (row.isbn13) {
        byIsbn.set(row.isbn13, row);
      }
    }

    const inserts: SlimBook[] = [];
    const updates: (SlimBook & { id: number })[] = [];

    for (const book of books) {
      const match =
        byBookId.get(book.bookloreBookId) ??
        (book.asin ? byAsin.get(book.asin) : undefined) ??
        (book.isbn13 ? byIsbn.get(book.isbn13) : undefined);

      if (!match) {
        inserts.push(book);
        continue;
      }

      // Only write rows that actually changed. On a steady-state re-scan this
      // makes the whole pass a single read and nothing else.
      const changed =
        match.bookloreBookId !== book.bookloreBookId ||
        (match.isbn13 ?? undefined) !== book.isbn13 ||
        (match.asin ?? undefined) !== book.asin ||
        (match.bookTitle ?? undefined) !== book.bookTitle ||
        (match.bookAuthor ?? undefined) !== book.bookAuthor ||
        (match.bookThumbnailUrl ?? undefined) !== book.bookThumbnailUrl ||
        match.status !== MediaStatus.AVAILABLE;

      if (changed) {
        updates.push({ ...book, id: match.id });
      }
    }

    return { inserts, updates };
  }

  private async insertAll(inserts: SlimBook[]): Promise<void> {
    const mediaRepository = getRepository(Media);

    for (let i = 0; i < inserts.length; i += WRITE_CHUNK) {
      if (!this.running) {
        return;
      }

      const chunk = inserts.slice(i, i + WRITE_CHUNK);

      await mediaRepository
        .createQueryBuilder()
        .insert()
        .into(Media)
        .values(
          chunk.map((book) => ({
            mediaType: MediaType.BOOK,
            // Presence in BookLore's library is the definition of available.
            status: MediaStatus.AVAILABLE,
            status4k: MediaStatus.UNKNOWN,
            ...book,
          }))
        )
        .execute();

      this.progress += chunk.length;
    }
  }

  private async updateAll(
    updates: (SlimBook & { id: number })[]
  ): Promise<void> {
    const mediaRepository = getRepository(Media);

    // Values differ per row, so these cannot be collapsed into one statement.
    // That is acceptable because only changed rows reach here.
    for (const book of updates) {
      if (!this.running) {
        return;
      }

      const { id, ...fields } = book;
      await mediaRepository.update(id, {
        ...fields,
        status: MediaStatus.AVAILABLE,
      });
    }
  }

  /**
   * Books Seerr believes are available but BookLore no longer has.
   *
   * Scoped to rows carrying a bookloreBookId, so a pending request — which has
   * no id until it is imported — is never touched. Computed against the rows
   * already in memory rather than with a NOT IN (...) over 140k ids.
   */
  private async markRemoved(
    books: SlimBook[],
    existing: ExistingBook[]
  ): Promise<number> {
    const seen = new Set(books.map((book) => book.bookloreBookId));

    const staleIds = existing
      .filter(
        (row) =>
          row.bookloreBookId != null &&
          row.status === MediaStatus.AVAILABLE &&
          !seen.has(row.bookloreBookId)
      )
      .map((row) => row.id);

    if (!staleIds.length) {
      return 0;
    }

    const mediaRepository = getRepository(Media);

    for (let i = 0; i < staleIds.length; i += WRITE_CHUNK) {
      const chunk = staleIds.slice(i, i + WRITE_CHUNK);
      await mediaRepository.update(
        { id: In(chunk) },
        { status: MediaStatus.DELETED }
      );
    }

    return staleIds.length;
  }
}

export const bookLoreScanner = new BookLoreScanner();
