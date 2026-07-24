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

export const bookRequestSchema = z.object({
  mediaType: z.literal(MediaType.BOOK),
  title: z.string().trim().min(1),
  author: z.string().trim().optional(),
  isbn13: z.string().trim().optional(),
  asin: z.string().trim().optional(),
  preferredFormat: z.enum(['EBOOK', 'AUDIOBOOK', 'ANY']).optional(),
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

  // A book already sitting in BookLore's library needs no request at all.
  const lookupMatch = await booklore
    .lookup(body.title)
    .then((results) =>
      results.find(
        (result) =>
          (body.asin && result.asin === body.asin) ||
          (body.isbn13 && result.isbn13 === body.isbn13)
      )
    )
    .catch(() => undefined);

  if (lookupMatch?.inLibrary) {
    media.status = MediaStatus.AVAILABLE;
    media.bookloreBookId = lookupMatch.existingBookId ?? undefined;
    await mediaRepository.save(media);

    throw new DuplicateMediaRequestError(
      'This book is already available in your library.'
    );
  }

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
