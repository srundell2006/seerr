import type {
  AddWantedBookOptions,
  PreferredFormat,
} from '@server/api/booklore';
import { getBookLoreClient } from '@server/api/booklore';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import {
  DuplicateMediaRequestError,
  MediaRequest,
  RequestPermissionError,
} from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { z } from 'zod';

/**
 * Metadata providers routinely return null for identifiers they don't carry —
 * every non-Audible result has a null ASIN, and plenty have no ISBN — and the
 * client forwards the record as it received it. `.optional()` alone rejects
 * null, so these are nullish and normalised to undefined. Empty strings are
 * treated the same way, since an absent identifier and a blank one mean the
 * same thing to the matching logic.
 */
const optionalText = z
  .string()
  .trim()
  .nullish()
  .transform((value) => value || undefined);

export const bookRequestSchema = z.object({
  mediaType: z.literal(MediaType.BOOK),
  title: z.string().trim().min(1),
  author: optionalText,
  isbn13: optionalText,
  asin: optionalText,
  preferredFormat: z
    .enum(['EBOOK', 'AUDIOBOOK', 'ANY'])
    .nullish()
    .transform((value) => value ?? undefined),
});

export type BookRequestBody = z.infer<typeof bookRequestSchema>;

/**
 * Books deliberately do NOT go through MediaRequest.request().
 *
 * That method is built end-to-end around the TMDB pipeline — it calls
 * getMovie/getTvShow to materialise the Media row, applies override rules that
 * only mean something to Radarr/Sonarr, and its final branch treats anything
 * that is not MOVIE as TV. Threading BOOK through it would mean touching every
 * one of those steps for a type that shares none of them, so books get their
 * own path and the movie/TV path stays untouched.
 */
export const createBookRequest = async (
  body: BookRequestBody,
  user: User
): Promise<MediaRequest> => {
  const mediaRepository = getRepository(Media);
  const requestRepository = getRepository(MediaRequest);

  if (
    !user.hasPermission([Permission.REQUEST, Permission.REQUEST_BOOK], {
      type: 'or',
    })
  ) {
    throw new RequestPermissionError(
      'You do not have permission to request books.'
    );
  }

  const booklore = getBookLoreClient();

  if (!booklore) {
    throw new Error('BookLore is not configured.');
  }

  // Identity resolution mirrors the client: ASIN first, then ISBN, then
  // title+author. An audiobook and its ebook edition share a title but never
  // an ASIN, so matching ISBN first would collapse the two formats.
  const existing = await findExistingBookMedia(body);

  if (existing) {
    // Already on the shelf, per the synced library.
    if (existing.status === MediaStatus.AVAILABLE) {
      throw new DuplicateMediaRequestError(
        'This book is already available in your library.'
      );
    }

    const activeRequest = (existing.requests ?? []).find(
      (request) =>
        request.status !== MediaRequestStatus.DECLINED &&
        request.status !== MediaRequestStatus.COMPLETED
    );

    if (activeRequest) {
      throw new DuplicateMediaRequestError(
        'This book has already been requested.'
      );
    }
  }

  const media =
    existing ??
    new Media({
      mediaType: MediaType.BOOK,
      isbn13: body.isbn13,
      asin: body.asin,
      status: MediaStatus.PENDING,
    });

  // Deliberately NO booklore.lookup() here. It used to run one on every
  // request to check inLibrary, which cost the full ~46s provider fan-out and
  // made the POST take 42 seconds — long enough that the browser gave up and
  // showed an error for a request that had actually succeeded. The synced
  // library answers the same question locally, above, in microseconds.
  await mediaRepository.save(media);

  const autoApprove = user.hasPermission(
    [Permission.AUTO_APPROVE, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );

  const request = new MediaRequest({
    type: MediaType.BOOK,
    media,
    requestedBy: user,
    status: autoApprove
      ? MediaRequestStatus.APPROVED
      : MediaRequestStatus.PENDING,
    bookTitle: body.title,
    bookAuthor: body.author,
    bookFormat: body.preferredFormat ?? 'ANY',
  });

  await requestRepository.save(request);

  logger.info(`Created book request for "${body.title}"`, {
    label: 'Book Request',
    requestId: request.id,
    autoApprove,
  });

  return request;
};

const findExistingBookMedia = async (
  body: BookRequestBody
): Promise<Media | null> => {
  const mediaRepository = getRepository(Media);

  if (body.asin) {
    const byAsin = await mediaRepository.findOne({
      where: { asin: body.asin, mediaType: MediaType.BOOK },
      relations: { requests: true },
    });
    if (byAsin) {
      return byAsin;
    }
  }

  if (body.isbn13) {
    const byIsbn = await mediaRepository.findOne({
      where: { isbn13: body.isbn13, mediaType: MediaType.BOOK },
      relations: { requests: true },
    });
    if (byIsbn) {
      return byIsbn;
    }
  }

  // Last resort. Only used when both title and author are known, because a
  // title alone matches far too broadly across a six-figure library.
  if (body.author) {
    const byTitleAuthor = await mediaRepository.findOne({
      where: {
        mediaType: MediaType.BOOK,
        bookTitle: body.title,
        bookAuthor: body.author,
      },
      relations: { requests: true },
    });
    if (byTitleAuthor) {
      return byTitleAuthor;
    }
  }

  return null;
};

/** Payload sent to BookLore when a book request is approved. */
export const toWantedBookOptions = (
  request: MediaRequest
): AddWantedBookOptions => ({
  title: request.bookTitle ?? '',
  author: request.bookAuthor ?? undefined,
  isbn13: request.media.isbn13 ?? undefined,
  asin: request.media.asin ?? undefined,
  preferredFormat: (request.bookFormat ?? 'ANY') as PreferredFormat,
});
