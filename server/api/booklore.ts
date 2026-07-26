import ExternalAPI from '@server/api/externalapi';
import type { BookLoreSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

/**
 * BookLore's own README states the HTTP API is undocumented and unversioned.
 * Every type below is transcribed field-for-field from the Java sources in
 * srundell2006/booklore@develop so a drift shows up as a type error here
 * rather than as silent `undefined` at runtime:
 *
 *   model/entity/WantedBookEntity.java
 *   model/enums/WantedBookStatus.java
 *   model/enums/MetadataProvider.java
 *   service/acquisition/BookLookupResult.java
 *   service/acquisition/ProwlarrRelease.java
 *   controller/WantedBookController.java
 *   controller/AuthenticationController.java
 */

export enum WantedBookStatus {
  WANTED = 'WANTED',
  GRABBED = 'GRABBED',
  IMPORTED = 'IMPORTED',
  FAILED = 'FAILED',
}

export type MetadataProvider =
  | 'Amazon'
  | 'GoodReads'
  | 'Google'
  | 'Hardcover'
  | 'OpenLibrary'
  | 'OpenLibraryLocal'
  | 'Comicvine'
  | 'Douban'
  | 'Lubimyczytac'
  | 'Ranobedb'
  | 'Audible'
  | 'Ollama';

/** BookLore stores this as a free-form column; these are the values we write. */
export type PreferredFormat = 'EBOOK' | 'AUDIOBOOK' | 'ANY';

export interface WantedBook {
  id: number;
  title: string;
  author?: string | null;
  isbn13?: string | null;
  asin?: string | null;
  status: WantedBookStatus;
  preferredFormat?: string | null;
  addedAt: string;
  lastSearchAt?: string | null;
  grabbedAt?: string | null;
  grabbedReleaseTitle?: string | null;
  grabbedIndexer?: string | null;
  downloadClient?: string | null;
  downloadId?: string | null;
  failureReason?: string | null;
  searchAttempts: number;
  importedBookId?: number | null;
  addedByUserId?: number | null;
}

export interface BookLookupResult {
  title: string;
  authors: string[];
  description?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  isbn13?: string | null;
  isbn10?: string | null;
  asin?: string | null;
  thumbnailUrl?: string | null;
  provider: MetadataProvider;
  /** True when a book with this ISBN (or title+author) already exists in BookLore. */
  inLibrary: boolean;
  /** Populated only when inLibrary is true. */
  existingBookId?: number | null;
  /** True when this book is already on BookLore's wanted list. */
  alreadyWanted: boolean;
}

export interface ProwlarrRelease {
  guid: string;
  title: string;
  indexer: string;
  indexerId?: number | null;
  size?: number | null;
  downloadUrl?: string | null;
  magnetUrl?: string | null;
  infoUrl?: string | null;
  protocol?: 'usenet' | 'torrent' | string | null;
  seeders?: number | null;
  leechers?: number | null;
  categories?: number[] | null;
  score?: number | null;
}

/**
 * A book in BookLore's own library, from GET /api/v1/books. Only the fields
 * the library sync needs are transcribed; the real DTO is much larger
 * (reading progress, shelves, per-format files) and none of it is our concern.
 */
export interface BookLoreBook {
  id: number;
  title?: string | null;
  addedOn?: string | null;
  metadata?: {
    title?: string | null;
    authors?: string[] | null;
    isbn13?: string | null;
    isbn10?: string | null;
    asin?: string | null;
    thumbnailUrl?: string | null;
    publisher?: string | null;
  } | null;
}

/**
 * A single book with its full metadata, from GET /api/v1/books/{id}.
 *
 * Everything except id is optional: BookLore omits null fields entirely, so a
 * book with no description, series or ratings simply has no such key.
 */
export interface BookLoreBookDetail extends BookLoreBook {
  libraryName?: string | null;
  isComic?: boolean | null;
  readStatus?: string | null;
  primaryFile?: {
    fileName?: string | null;
    fileSizeKb?: number | null;
    bookType?: string | null;
  } | null;
  metadata?: BookLoreBook['metadata'] & {
    subtitle?: string | null;
    description?: string | null;
    publishedDate?: string | null;
    pageCount?: number | null;
    language?: string | null;
    seriesName?: string | null;
    seriesNumber?: number | null;
    seriesTotal?: number | null;
    categories?: string[] | null;
    amazonRating?: number | null;
    goodreadsRating?: number | null;
    hardcoverRating?: number | null;
  };
}

export interface AddWantedBookOptions {
  title: string;
  author?: string;
  isbn13?: string;
  asin?: string;
  preferredFormat?: PreferredFormat;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * BookLore's lookup fans out across twelve metadata providers (including
 * Audible and an Ollama model) and measured ~46s against a real instance, so
 * it cannot share Seerr's global apiRequestTimeout — that defaults to 10s and
 * aborted every single search.
 */
const LOOKUP_TIMEOUT = 180000;

/**
 * Everything other than lookup is a plain database read on BookLore's side and
 * returns fast; this only needs to be generous enough for a large library.
 */
const DEFAULT_TIMEOUT = 60000;

/**
 * The library read is one unpaged request for the entire catalogue —
 * BookLore's /books takes no paging parameters. Measured against a real
 * instance: 140,482 books, 139 MB, 101 seconds. The bound is deliberately
 * several times that so a slower disk or a bigger library still completes.
 */
const LIBRARY_TIMEOUT = 600000;

/** Endpoints that must never carry (or trigger a refresh of) a bearer token. */
const AUTH_PATHS = ['/api/v1/auth/login', '/api/v1/auth/refresh'];

const isAuthPath = (url?: string): boolean =>
  !!url && AUTH_PATHS.some((path) => url.includes(path));

type RetriableConfig = InternalAxiosRequestConfig & {
  _bookloreRetry?: boolean;
};

class BookLoreAPI extends ExternalAPI {
  static buildUrl(settings: BookLoreSettings, path = ''): string {
    return `${settings.useSsl ? 'https' : 'http'}://${settings.hostname}:${
      settings.port
    }${settings.baseUrl ?? ''}${path}`;
  }

  private username: string;
  private password: string;
  private accessToken?: string;
  private refreshToken?: string;
  /**
   * Shared in-flight authentication. Concurrent callers await the same promise
   * instead of stampeding /auth/login with N identical logins.
   */
  private authPromise?: Promise<void>;

  constructor({
    url,
    username,
    password,
  }: {
    url: string;
    username: string;
    password: string;
  }) {
    super(
      url,
      {},
      {
        // Deliberately no nodeCache: a cached wanted-list would defeat the
        // whole point of the poller, and caching would require an
        // AvailableCacheIds entry we don't otherwise need.
        timeout: DEFAULT_TIMEOUT,
      }
    );

    this.username = username;
    this.password = password;

    this.axios.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        if (this.accessToken && !isAuthPath(config.url)) {
          config.headers.set('Authorization', `Bearer ${this.accessToken}`);
        }
        return config;
      }
    );

    this.axios.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const config = error.config as RetriableConfig | undefined;

        // Only a 401 on a non-auth request is worth retrying, and only once —
        // the flag keeps a genuinely bad credential failing fast instead of
        // looping login/replay forever.
        if (
          !config ||
          error.response?.status !== 401 ||
          isAuthPath(config.url) ||
          config._bookloreRetry
        ) {
          throw error;
        }

        config._bookloreRetry = true;
        this.accessToken = undefined;

        await this.authenticate();

        return this.axios.request(config);
      }
    );
  }

  /**
   * Logs in (or refreshes) exactly once across concurrent callers.
   */
  private async authenticate(): Promise<void> {
    if (this.authPromise) {
      return this.authPromise;
    }

    this.authPromise = (async () => {
      if (this.refreshToken) {
        try {
          const tokens = await this.post<TokenPair>('/api/v1/auth/refresh', {
            refreshToken: this.refreshToken,
          });
          this.accessToken = tokens.accessToken;
          this.refreshToken = tokens.refreshToken;
          return;
        } catch {
          // A dead refresh token is expected on restart or after rotation;
          // fall through to a full login rather than surfacing it.
          logger.debug(
            'BookLore refresh token rejected, falling back to full login',
            { label: 'BookLore API' }
          );
          this.refreshToken = undefined;
        }
      }

      const tokens = await this.post<TokenPair>('/api/v1/auth/login', {
        username: this.username,
        password: this.password,
      });
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
    })().finally(() => {
      this.authPromise = undefined;
    });

    return this.authPromise;
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.accessToken) {
      await this.authenticate();
    }
  }

  /**
   * Logs in and then hits an endpoint the integration actually needs.
   *
   * A non-admin BookLore account logs in perfectly happily and then 403s on
   * every wanted-books endpoint — checking login alone would report a false
   * green for a service account that cannot do the job.
   */
  public async testConnection(): Promise<boolean> {
    try {
      this.accessToken = undefined;
      this.refreshToken = undefined;
      await this.authenticate();
      await this.getWantedBooks();
      return true;
    } catch (e) {
      const status = (e as AxiosError).response?.status;
      logger.error('BookLore connection test failed', {
        label: 'BookLore API',
        errorMessage: e instanceof Error ? e.message : String(e),
        status,
        hint:
          status === 403
            ? 'The configured BookLore account is not an admin; every wanted-books endpoint requires admin.'
            : undefined,
      });
      return false;
    }
  }

  /**
   * BookLore's library in one shot — the endpoint takes no paging parameters,
   * so this is deliberately a full read. Descriptions are left out: they
   * multiply the payload size and the sync has no use for them.
   */
  public async getBooks(): Promise<BookLoreBook[]> {
    await this.ensureAuthenticated();
    return this.get<BookLoreBook[]>(
      '/api/v1/books',
      { params: { withDescription: false }, timeout: LIBRARY_TIMEOUT },
      0
    );
  }

  /**
   * Fetches a book's cover image bytes.
   *
   * BookLore guards /api/v1/media/** with a filter that reads the JWT from a
   * `token` query parameter and rejects the request before normal bearer auth
   * is considered — an Authorization header alone returns 401. Its tokens are
   * also short-lived, which is why Seerr proxies these rather than pointing
   * the browser straight at BookLore.
   */
  public async fetchCover(
    bookloreBookId: number,
    size: 'thumbnail' | 'cover' = 'thumbnail'
  ): Promise<Buffer> {
    await this.ensureAuthenticated();

    const response = await this.axios.get<ArrayBuffer>(
      `/api/v1/media/book/${bookloreBookId}/${size}`,
      { params: { token: this.accessToken }, responseType: 'arraybuffer' }
    );

    return Buffer.from(response.data);
  }

  /** One book with full metadata, for the detail page. */
  public async getBook(bookloreBookId: number): Promise<BookLoreBookDetail> {
    await this.ensureAuthenticated();
    return this.get<BookLoreBookDetail>(
      `/api/v1/books/${bookloreBookId}`,
      { params: { withDescription: true } },
      0
    );
  }

  public async getWantedBooks(): Promise<WantedBook[]> {
    await this.ensureAuthenticated();
    return this.get<WantedBook[]>('/api/v1/wanted-books', undefined, 0);
  }

  /**
   * Free-text search across BookLore's configured metadata providers,
   * annotated with `inLibrary` / `existingBookId` / `alreadyWanted`.
   *
   * This single call covers all three questions Seerr needs answered:
   * does the book exist, is it already in the library, is it already requested.
   */
  public async lookup(query: string): Promise<BookLookupResult[]> {
    await this.ensureAuthenticated();
    return this.get<BookLookupResult[]>(
      '/api/v1/wanted-books/lookup',
      { params: { query }, timeout: LOOKUP_TIMEOUT },
      0
    );
  }

  /**
   * POST /wanted-books does NOT dedupe — it builds and saves unconditionally.
   * Callers must check `alreadyWanted` from lookup() first, or use
   * addWantedBookIfAbsent() below.
   */
  public async addWantedBook(
    options: AddWantedBookOptions
  ): Promise<WantedBook> {
    await this.ensureAuthenticated();
    return this.post<WantedBook>('/api/v1/wanted-books', { ...options }, {}, 0);
  }

  /**
   * Dedupe-safe wrapper: matches an existing wanted entry on ASIN, then ISBN,
   * then title+author before creating a new one.
   */
  public async addWantedBookIfAbsent(
    options: AddWantedBookOptions
  ): Promise<WantedBook> {
    const existing = matchWantedBook(await this.getWantedBooks(), options);

    if (existing) {
      logger.debug(
        `Book already on BookLore wanted list, skipping create: ${options.title}`,
        { label: 'BookLore API', wantedBookId: existing.id }
      );
      return existing;
    }

    return this.addWantedBook(options);
  }

  public async deleteWantedBook(id: number): Promise<void> {
    await this.ensureAuthenticated();
    await this.axios.delete(`/api/v1/wanted-books/${id}`);
  }

  public async resetWantedBook(id: number): Promise<WantedBook> {
    await this.ensureAuthenticated();
    const response = await this.axios.patch<WantedBook>(
      `/api/v1/wanted-books/${id}/reset`
    );
    return response.data;
  }

  public async searchReleases(id: number): Promise<ProwlarrRelease[]> {
    await this.ensureAuthenticated();
    return this.post<ProwlarrRelease[]>(
      `/api/v1/wanted-books/${id}/search`,
      undefined,
      {},
      0
    );
  }

  public async grabRelease(
    id: number,
    release: ProwlarrRelease
  ): Promise<WantedBook> {
    await this.ensureAuthenticated();
    return this.post<WantedBook>(
      `/api/v1/wanted-books/${id}/grab`,
      { ...release },
      {},
      0
    );
  }

  /** Fire-and-forget on BookLore's side: it returns 202 and runs async. */
  public async searchAll(): Promise<void> {
    await this.ensureAuthenticated();
    await this.post<void>('/api/v1/wanted-books/search-all', undefined, {}, 0);
  }
}

/**
 * Identity matching for wanted books.
 *
 * ASIN is checked before ISBN on purpose: an audiobook and its ebook edition
 * share a title and often an ISBN-adjacent identity but never an ASIN, so
 * matching ISBN first would silently collapse the two formats into one entry.
 */
export const matchWantedBook = (
  books: WantedBook[],
  criteria: {
    asin?: string | null;
    isbn13?: string | null;
    title?: string | null;
    author?: string | null;
  }
): WantedBook | undefined => {
  if (criteria.asin) {
    const byAsin = books.find((book) => book.asin === criteria.asin);
    if (byAsin) {
      return byAsin;
    }
  }

  if (criteria.isbn13) {
    const byIsbn = books.find((book) => book.isbn13 === criteria.isbn13);
    if (byIsbn) {
      return byIsbn;
    }
  }

  if (!criteria.title) {
    return undefined;
  }

  const title = criteria.title.trim().toLowerCase();
  const author = criteria.author?.trim().toLowerCase();

  return books.find(
    (book) =>
      book.title.trim().toLowerCase() === title &&
      (!author || (book.author ?? '').trim().toLowerCase() === author)
  );
};

let cachedClient: BookLoreAPI | null = null;
let cachedConnectionKey = '';

/**
 * Returns the shared client for the saved settings, or null when BookLore is
 * not configured. Keeps every caller from repeating the same guard.
 *
 * The instance is deliberately reused. Each client holds its own JWT, so
 * building a fresh one per request meant a fresh login per request — and a
 * poster grid asking for twenty covers at once fired twenty simultaneous
 * logins, which BookLore answers with 400 for all but the first. Sharing one
 * instance also lets the in-flight auth promise do its job: concurrent callers
 * wait on a single login instead of stampeding /auth/login.
 *
 * The cache is keyed on the connection settings, so editing the host or
 * credentials replaces the client rather than leaving a stale session behind.
 */
export const getBookLoreClient = (): BookLoreAPI | null => {
  const settings = getSettings().booklore;

  if (!settings.enabled || !settings.hostname || !settings.username) {
    cachedClient = null;
    cachedConnectionKey = '';
    return null;
  }

  const connectionKey = [
    settings.hostname,
    settings.port,
    settings.useSsl,
    settings.baseUrl ?? '',
    settings.username,
    settings.password,
  ].join('|');

  if (!cachedClient || connectionKey !== cachedConnectionKey) {
    cachedClient = new BookLoreAPI({
      url: BookLoreAPI.buildUrl(settings),
      username: settings.username,
      password: settings.password,
    });
    cachedConnectionKey = connectionKey;
  }

  return cachedClient;
};

export default BookLoreAPI;
