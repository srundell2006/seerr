import type { WantedBook } from '@server/api/booklore';
import {
  WantedBookStatus,
  getBookLoreClient,
  matchWantedBook,
} from '@server/api/booklore';
import logger from '@server/logger';

export interface BookLoreTransition {
  book: WantedBook;
  previousStatus: WantedBookStatus;
  currentStatus: WantedBookStatus;
}

export type BookLoreTransitionHandler = (
  transition: BookLoreTransition
) => void | Promise<void>;

export interface BookLoreTrackerStatus {
  running: boolean;
  progress: number;
  total: number;
  initialized: boolean;
  lastSyncedAt?: Date;
}

/**
 * Polls BookLore's wanted list and emits status transitions.
 *
 * BookLore has no callback/webhook on import, so status tracking is
 * polling-only by necessity. Shaped after DownloadTracker: an in-memory
 * snapshot refreshed on a schedule, with synchronous accessors for callers.
 *
 * This deliberately writes nothing to Media — that is the seam for after the
 * Media.tmdbId nullable migration lands. Until then it observes and reports.
 */
class BookLoreTracker {
  private wantedBooks: WantedBook[] = [];
  private lastStatuses = new Map<number, WantedBookStatus>();
  private transitionHandlers: BookLoreTransitionHandler[] = [];
  private running = false;
  private initialized = false;
  private lastSyncedAt?: Date;

  public getWantedBooks(): WantedBook[] {
    return this.wantedBooks;
  }

  public getWantedBook(id: number): WantedBook | undefined {
    return this.wantedBooks.find((book) => book.id === id);
  }

  /**
   * Synchronous lookup against the last snapshot. ASIN is matched before ISBN
   * so an audiobook and its ebook edition don't collapse into one entry.
   */
  public find(criteria: {
    asin?: string | null;
    isbn13?: string | null;
    title?: string | null;
    author?: string | null;
  }): WantedBook | undefined {
    return matchWantedBook(this.wantedBooks, criteria);
  }

  public getProgress(id: number): WantedBookStatus | undefined {
    return this.getWantedBook(id)?.status;
  }

  /** Registers a transition handler and returns an unsubscribe function. */
  public onTransition(handler: BookLoreTransitionHandler): () => void {
    this.transitionHandlers.push(handler);

    return () => {
      this.transitionHandlers = this.transitionHandlers.filter(
        (registered) => registered !== handler
      );
    };
  }

  public status(): BookLoreTrackerStatus {
    return {
      running: this.running,
      progress: this.wantedBooks.filter(
        (book) =>
          book.status === WantedBookStatus.WANTED ||
          book.status === WantedBookStatus.GRABBED
      ).length,
      total: this.wantedBooks.length,
      initialized: this.initialized,
      lastSyncedAt: this.lastSyncedAt,
    };
  }

  public reset(): void {
    this.wantedBooks = [];
    this.lastStatuses.clear();
    this.initialized = false;
    this.lastSyncedAt = undefined;
    logger.debug('BookLore tracker reset', { label: 'BookLore Tracker' });
  }

  public async run(): Promise<void> {
    if (this.running) {
      logger.debug('BookLore sync already in progress, skipping this tick', {
        label: 'BookLore Tracker',
      });
      return;
    }

    const booklore = getBookLoreClient();

    if (!booklore) {
      return;
    }

    this.running = true;

    try {
      const books = await booklore.getWantedBooks();
      const transitions = this.diff(books);

      this.wantedBooks = books;
      this.lastSyncedAt = new Date();

      if (books.length > 0) {
        logger.debug(`Found ${books.length} wanted book(s) in BookLore`, {
          label: 'BookLore Tracker',
        });
      }

      for (const transition of transitions) {
        this.emit(transition);
      }
    } catch (e) {
      logger.error('Unable to get wanted books from BookLore', {
        label: 'BookLore Tracker',
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.running = false;
    }
  }

  /**
   * Diffs incoming statuses against the previous snapshot.
   *
   * First sight of a book is never a transition. Without that guard every
   * restart would replay the entire wanted list as fresh IMPORTED/FAILED
   * events and flood notifications with things that happened days ago.
   */
  private diff(books: WantedBook[]): BookLoreTransition[] {
    const transitions: BookLoreTransition[] = [];
    const seen = new Set<number>();

    for (const book of books) {
      seen.add(book.id);
      const previousStatus = this.lastStatuses.get(book.id);
      this.lastStatuses.set(book.id, book.status);

      if (previousStatus === undefined) {
        continue;
      }

      if (previousStatus !== book.status) {
        transitions.push({
          book,
          previousStatus,
          currentStatus: book.status,
        });
      }
    }

    // Drop books deleted in BookLore so a re-add is treated as first sight
    // rather than as a transition from whatever it was months ago.
    for (const id of this.lastStatuses.keys()) {
      if (!seen.has(id)) {
        this.lastStatuses.delete(id);
      }
    }

    if (!this.initialized) {
      this.initialized = true;
      return [];
    }

    return transitions;
  }

  private emit(transition: BookLoreTransition): void {
    logger.info(
      `BookLore: "${transition.book.title}" ${transition.previousStatus} -> ${transition.currentStatus}`,
      { label: 'BookLore Tracker', wantedBookId: transition.book.id }
    );

    for (const handler of this.transitionHandlers) {
      try {
        const result = handler(transition);
        if (result instanceof Promise) {
          result.catch((e) => {
            logger.error('BookLore transition handler failed', {
              label: 'BookLore Tracker',
              errorMessage: e instanceof Error ? e.message : String(e),
            });
          });
        }
      } catch (e) {
        logger.error('BookLore transition handler failed', {
          label: 'BookLore Tracker',
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
}

const bookLoreTracker = new BookLoreTracker();

export default bookLoreTracker;
