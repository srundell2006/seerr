import type { BookLookupResult, WantedBook } from '@server/api/booklore';
import { getBookLoreClient } from '@server/api/booklore';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import bookLoreTracker from '@server/lib/bookloretracker';
import logger from '@server/logger';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { In } from 'typeorm';

const bookRoutes = Router();

export interface BookSearchResult extends BookLookupResult {
  mediaInfo?: { id: number; status: number } | null;
}

/**
 * Exported so /api/v1/search/books can share the exact same handler — the UI
 * searches under /search for discoverability, but the logic belongs here.
 */
export const bookSearchHandler: RequestHandler = async (req, res, next) => {
  const booklore = getBookLoreClient();

  // Distinct codes matter here: the UI previously rendered every 500 as
  // "BookLore is not configured", which sent a timeout hunt in entirely the
  // wrong direction. Never collapse these three into one status again.
  if (!booklore) {
    return next({
      status: 503,
      message: 'BookLore is not configured.',
      code: 'BOOKLORE_NOT_CONFIGURED',
    });
  }

  const query = (req.query.query as string | undefined)?.trim();

  if (!query) {
    return res.status(200).json({ results: [] });
  }

  try {
    const results = await booklore.lookup(query);
    const decorated = await decorateWithMediaInfo(results);

    return res.status(200).json({ results: decorated });
  } catch (e) {
    const isTimeout =
      (e as { code?: string }).code === 'ECONNABORTED' ||
      (e as { code?: string }).code === 'ETIMEDOUT';

    logger.error('Book search failed', {
      label: 'Books',
      errorMessage: e instanceof Error ? e.message : String(e),
      isTimeout,
    });

    return next(
      isTimeout
        ? {
            status: 504,
            message:
              "BookLore's metadata providers did not respond in time. Try a more specific title.",
            code: 'BOOKLORE_TIMEOUT',
          }
        : {
            status: 500,
            message: 'Book search failed.',
            code: 'BOOKLORE_SEARCH_FAILED',
          }
    );
  }
};

/**
 * Seerr's own synced copy of BookLore's library, populated by the BookLore
 * Library Scan job. Read from the local table rather than BookLore so the UI
 * is not paying ~46s per lookup just to answer "what do we already have".
 */
bookRoutes.get('/library', async (req, res, next) => {
  try {
    const pageSize = req.query.take ? Number(req.query.take) : 20;
    const skip = req.query.skip ? Number(req.query.skip) : 0;
    const search = (req.query.search as string | undefined)?.trim();

    let query = getRepository(Media)
      .createQueryBuilder('media')
      .where('media.mediaType = :mediaType', { mediaType: MediaType.BOOK })
      .andWhere('media.bookloreBookId IS NOT NULL');

    if (search) {
      query = query.andWhere(
        '(LOWER(media.bookTitle) LIKE :search OR LOWER(media.bookAuthor) LIKE :search)',
        { search: `%${search.toLowerCase()}%` }
      );
    }

    const [items, count] = await query
      .orderBy('media.bookTitle', 'ASC')
      .take(pageSize)
      .skip(skip)
      .getManyAndCount();

    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(count / pageSize),
        pageSize,
        results: count,
        page: Math.ceil(skip / pageSize) + 1,
      },
      results: items.map((media) => ({
        id: media.id,
        bookloreBookId: media.bookloreBookId,
        title: media.bookTitle,
        author: media.bookAuthor,
        isbn13: media.isbn13,
        asin: media.asin,
        thumbnailUrl: media.bookThumbnailUrl,
        status: media.status,
      })),
    });
  } catch (e) {
    logger.error('Failed to read the synced book library', {
      label: 'Books',
      errorMessage: e instanceof Error ? e.message : String(e),
    });

    return next({ status: 500, message: 'Failed to read the book library.' });
  }
});

bookRoutes.get('/search', bookSearchHandler);

/**
 * Served from the tracker's snapshot rather than BookLore directly, so a UI
 * polling this every 30s costs nothing and stays consistent with the status
 * transitions the tracker has already emitted.
 */
bookRoutes.get<never, { results: WantedBook[] }>('/wanted', (_req, res) => {
  return res.status(200).json({ results: bookLoreTracker.getWantedBooks() });
});

/**
 * Attaches Seerr's own Media row to each lookup result so the UI can tell
 * "BookLore has it" apart from "Seerr has a request for it".
 *
 * Matches on ASIN and ISBN only — a title+author fallback would be guesswork
 * across twelve metadata providers whose title formatting does not agree.
 */
const decorateWithMediaInfo = async (
  results: BookLookupResult[]
): Promise<BookSearchResult[]> => {
  const isbns = results
    .map((result) => result.isbn13)
    .filter((isbn): isbn is string => !!isbn);
  const asins = results
    .map((result) => result.asin)
    .filter((asin): asin is string => !!asin);

  if (!isbns.length && !asins.length) {
    return results.map((result) => ({ ...result, mediaInfo: null }));
  }

  const mediaRepository = getRepository(Media);
  const existing = await mediaRepository.find({
    where: [
      ...(isbns.length
        ? [{ mediaType: MediaType.BOOK, isbn13: In(isbns) }]
        : []),
      ...(asins.length ? [{ mediaType: MediaType.BOOK, asin: In(asins) }] : []),
    ],
  });

  return results.map((result) => {
    const match = existing.find(
      (media) =>
        (result.asin && media.asin === result.asin) ||
        (result.isbn13 && media.isbn13 === result.isbn13)
    );

    return {
      ...result,
      mediaInfo: match ? { id: match.id, status: match.status } : null,
    };
  });
};

export default bookRoutes;
