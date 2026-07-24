import { MediaType } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { WatchlistItem } from '@server/interfaces/api/discoverInterfaces';

/**
 * Narrows to the media types that have a TMDB identity and a title card.
 *
 * Books are deliberately excluded: they are sourced from BookLore, have no
 * TMDB record (and therefore no `tmdbId`, poster, backdrop or `/movie|/tv`
 * deep link), and are browsed and requested through `/books` instead. Anything
 * that renders a TMDB-shaped card or builds a TMDB URL must gate on this
 * rather than assuming every media type is a movie or a series.
 */
export const isTmdbMediaType = (
  mediaType: MediaType | string | undefined
): mediaType is MediaType.MOVIE | MediaType.TV =>
  mediaType === MediaType.MOVIE || mediaType === MediaType.TV;

/**
 * Narrows a watchlist entry to one that can be rendered as a TMDB title card.
 * Use it to filter book entries out of watchlist collections before mapping.
 */
export const isTmdbWatchlistItem = (
  item: WatchlistItem
): item is WatchlistItem & { mediaType: 'movie' | 'tv' } =>
  isTmdbMediaType(item.mediaType);

/**
 * Narrows a media record to one that can be rendered as a TMDB title card,
 * i.e. a movie or series that actually carries a `tmdbId`.
 */
export const isTmdbMedia = (
  media: Media
): media is Media & {
  tmdbId: number;
  mediaType: MediaType.MOVIE | MediaType.TV;
} => isTmdbMediaType(media.mediaType) && media.tmdbId !== undefined;
