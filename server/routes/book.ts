import type {
  BookLookupResult,
  MetadataProvider,
  WantedBook,
} from '@server/api/booklore';
import { getBookLoreClient } from '@server/api/booklore';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import bookLoreTracker from '@server/lib/bookloretracker';
import logger from '@server/logger';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { In } from 'typeorm';

const bookRoutes = Router();

export interface BookSearchResult extends Omit<BookLookupResult, 'provider'> {
  /** 'Library' marks a result answered from Seerr's own synced rows. */
  provider: MetadataProvider | 'Library';
  /** Ready-to-render cover: the Seerr proxy, or the provider's thumbnail. */
  coverUrl?: string | null;
  mediaInfo?: { id: number; status: number } | null;
}

/** ISBN-13 / ISBN-10 once hyphens and spaces are stripped. */
const ISBN_PATTERN = /^(?:\d{13}|\d{9}[\dXx])$/;
const ASIN_PATTERN = /^B[0-9A-Z]{9}$/i;

const stripIsbnPunctuation = (value: string): string =>
  value.replace(/[\s-]/g, '');

/**
 * Answers identifier searches from Seerr's own synced library before going
 * near BookLore.
 *
 * A BookLore lookup costs ~46s because it fans out across twelve metadata
 * providers. For a book already on the shelf that is entirely wasted — the
 * library scan has the answer locally, indexed on isbn13 and asin.
 */
const findInSyncedLibrary = async (
  query: string
): Promise<BookSearchResult | null> => {
  const compact = stripIsbnPunctuation(query);
  const isIsbn = ISBN_PATTERN.test(compact);
  const isAsin = ASIN_PATTERN.test(query);

  if (!isIsbn && !isAsin) {
    return null;
  }

  const media = await getRepository(Media).findOne({
    where: isIsbn
      ? { mediaType: MediaType.BOOK, isbn13: compact }
      : { mediaType: MediaType.BOOK, asin: query.toUpperCase() },
  });

  if (!media || media.status !== MediaStatus.AVAILABLE) {
    return null;
  }

  return {
    title: media.bookTitle ?? query,
    authors: media.bookAuthor ? [media.bookAuthor] : [],
    isbn13: media.isbn13 ?? null,
    asin: media.asin ?? null,
    thumbnailUrl: media.bookThumbnailUrl ?? null,
    provider: 'Library',
    inLibrary: true,
    existingBookId: media.bookloreBookId ?? null,
    alreadyWanted: false,
    coverUrl: media.bookloreBookId
      ? `/api/v1/book/cover/${media.bookloreBookId}`
      : null,
    mediaInfo: { id: media.id, status: media.status },
  };
};

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
    // Identifier searches for books we already have never need to touch
    // BookLore, which turns a ~46s wait into a local index hit.
    const local = await findInSyncedLibrary(query);

    if (local) {
      logger.debug(`Answered "${query}" from the synced library`, {
        label: 'Books',
      });
      return res.status(200).json({ results: [local] });
    }

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
 * Sniffs the image type from magic bytes.
 *
 * BookLore serves cover bytes with Content-Type application/json, so its own
 * header cannot be forwarded — a browser would refuse to render it.
 */
const detectImageType = (buffer: Buffer): string => {
  if (buffer.length >= 3 && buffer.toString('hex', 0, 3) === 'ffd8ff') {
    return 'image/jpeg';
  }
  if (buffer.length >= 4 && buffer.toString('hex', 0, 4) === '89504e47') {
    return 'image/png';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'GIF8') {
    return 'image/gif';
  }
  return 'application/octet-stream';
};

/**
 * Proxies a book cover out of BookLore.
 *
 * The browser cannot fetch these directly: BookLore wants a short-lived JWT in
 * a `token` query parameter, which a plain <img> tag has no way to keep fresh.
 * Seerr holds the service-account session already, so it fetches and forwards.
 */
bookRoutes.get('/cover/:bookloreBookId', async (req, res, next) => {
  const booklore = getBookLoreClient();

  if (!booklore) {
    return next({
      status: 503,
      message: 'BookLore is not configured.',
      code: 'BOOKLORE_NOT_CONFIGURED',
    });
  }

  const bookloreBookId = Number(req.params.bookloreBookId);

  if (!Number.isInteger(bookloreBookId) || bookloreBookId <= 0) {
    return next({ status: 400, message: 'Invalid book id.' });
  }

  const size = req.query.size === 'cover' ? 'cover' : 'thumbnail';

  try {
    const image = await booklore.fetchCover(bookloreBookId, size);

    res.setHeader('Content-Type', detectImageType(image));
    // Covers only change when the book's metadata is edited, so let the
    // browser keep them rather than re-proxying on every grid render.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(image);
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status;

    if (status === 404) {
      return next({ status: 404, message: 'Cover not found.' });
    }

    logger.debug('Failed to proxy book cover', {
      label: 'Books',
      bookloreBookId,
      errorMessage: e instanceof Error ? e.message : String(e),
    });

    return next({ status: 500, message: 'Failed to load cover.' });
  }
});

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
        // Always the proxy: BookLore's /books payload carries no thumbnail
        // URL at all, so the cover endpoint is the only source for a synced
        // book's artwork.
        coverUrl: media.bookloreBookId
          ? `/api/v1/book/cover/${media.bookloreBookId}`
          : null,
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
      // Provider results carry their own thumbnail; anything already in
      // BookLore gets the proxied cover, which is both authoritative and
      // not dependent on an external host staying up.
      coverUrl: result.existingBookId
        ? `/api/v1/book/cover/${result.existingBookId}`
        : (result.thumbnailUrl ?? null),
      mediaInfo: match ? { id: match.id, status: match.status } : null,
    };
  });
};

export default bookRoutes;
