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
import { IsNull, Not } from 'typeorm';

const BATCH_SIZE = 200;

/**
 * Mirrors BookLore's library into Seerr's Media table, the same way the Plex
 * and Jellyfin scanners mirror those libraries.
 *
 * Without this, Seerr only ever knows about books somebody explicitly
 * requested — a book already sitting on the shelf would still show as
 * requestable. BookLore's lookup does return an `inLibrary` flag, but it costs
 * ~46s per query because it fans out across twelve metadata providers, so it
 * cannot be the thing that answers "do we already have this" on every render.
 * Syncing once per scan and reading Seerr's own table is what makes that cheap.
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

    try {
      logger.info('BookLore library scan starting', { label: 'BookLore Scan' });

      const books = await booklore.getBooks();
      this.total = books.length;

      const seenBookIds: number[] = [];

      for (let i = 0; i < books.length; i += BATCH_SIZE) {
        if (!this.running) {
          logger.info('BookLore library scan cancelled', {
            label: 'BookLore Scan',
          });
          return;
        }

        const batch = books.slice(i, i + BATCH_SIZE);
        await this.processBatch(batch, seenBookIds);
        this.progress += batch.length;
      }

      const removed = await this.markRemoved(seenBookIds);

      logger.info(
        `BookLore library scan complete: ${books.length} book(s) synced${
          removed ? `, ${removed} no longer in the library` : ''
        }`,
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

  private async processBatch(
    books: BookLoreBook[],
    seenBookIds: number[]
  ): Promise<void> {
    const mediaRepository = getRepository(Media);

    for (const book of books) {
      seenBookIds.push(book.id);

      const metadata = book.metadata ?? {};
      const isbn13 = metadata.isbn13 ?? undefined;
      const asin = metadata.asin ?? undefined;

      // bookloreBookId first — it is the only identifier guaranteed to exist
      // and to be stable. ASIN before ISBN for the usual reason: an audiobook
      // and its ebook edition share a title but never an ASIN.
      let media =
        (await mediaRepository.findOne({
          where: { bookloreBookId: book.id, mediaType: MediaType.BOOK },
        })) ?? null;

      if (!media && asin) {
        media = await mediaRepository.findOne({
          where: { asin, mediaType: MediaType.BOOK },
        });
      }

      if (!media && isbn13) {
        media = await mediaRepository.findOne({
          where: { isbn13, mediaType: MediaType.BOOK },
        });
      }

      if (!media) {
        media = new Media({ mediaType: MediaType.BOOK });
      }

      media.bookloreBookId = book.id;
      media.isbn13 = isbn13;
      media.asin = asin;
      media.bookTitle = metadata.title ?? book.title ?? undefined;
      media.bookAuthor = metadata.authors?.join(', ') || undefined;
      media.bookThumbnailUrl = metadata.thumbnailUrl ?? undefined;
      // Presence in BookLore's library is the definition of available.
      media.status = MediaStatus.AVAILABLE;

      await mediaRepository.save(media);
    }
  }

  /**
   * Books Seerr thinks are available but BookLore no longer has.
   *
   * Scoped to rows that carry a bookloreBookId, so a pending request — which
   * has no id yet because it has not been imported — is never touched.
   */
  private async markRemoved(seenBookIds: number[]): Promise<number> {
    const mediaRepository = getRepository(Media);
    const seen = new Set(seenBookIds);

    // Filtered in JS rather than with NOT IN (...): a large library would put
    // tens of thousands of ids into a single SQL statement.
    const candidates = await mediaRepository.find({
      where: {
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
        bookloreBookId: Not(IsNull()),
      },
    });

    const stale = candidates.filter(
      (media) => media.bookloreBookId != null && !seen.has(media.bookloreBookId)
    );

    for (const media of stale) {
      media.status = MediaStatus.DELETED;
      await mediaRepository.save(media);
    }

    return stale.length;
  }
}

export const bookLoreScanner = new BookLoreScanner();
