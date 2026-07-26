import BookCard from '@app/components/BookSearch/BookCard';
import Button from '@app/components/Common/Button';
import { SmallLoadingSpinner } from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowPathIcon,
  BookOpenIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid';
import type { MediaStatus } from '@server/constants/media';
import axios from 'axios';
import Link from 'next/link';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.BookSearch', {
  searchPlaceholder: 'Search for books by title, author, or ISBN',
  search: 'Search',
  searching: 'Searching…',
  startSearching:
    'Enter a title, author, or ISBN above and press Search to look for books.',
  searchInProgress:
    "Searching BookLore's metadata providers — this can take up to a minute.",
  nobooksfound: 'No books found.',
  bookloreNotConfigured: 'BookLore is not configured.',
  bookloreNotConfiguredDescription:
    'Books cannot be searched or requested until BookLore has been set up.',
  configureBooklore: 'Configure BookLore',
  bookloreTimedOut: 'The book search timed out.',
  bookloreTimedOutDescription:
    "BookLore's metadata providers took too long to respond. Try again, or use a more specific search such as an ISBN.",
  bookloreSearchFailed: 'The book search failed.',
  unknownAuthor: 'Unknown Author',
  requestBook: 'Request Book',
  preferredFormat: 'Preferred Format',
  formatEbook: 'Ebook',
  formatAudiobook: 'Audiobook',
  formatAny: 'Either',
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestDuplicate: '<strong>{title}</strong> has already been requested.',
  requestPermissionDenied: 'You do not have permission to request this book.',
  requestError: 'Something went wrong while requesting this book.',
});

type PreferredFormat = 'EBOOK' | 'AUDIOBOOK' | 'ANY';

export interface BookSearchResult {
  title: string;
  authors: string[];
  description?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  isbn13?: string | null;
  isbn10?: string | null;
  asin?: string | null;
  thumbnailUrl?: string | null;
  /**
   * Ready-to-render cover URL: the Seerr proxy when the book is already in
   * BookLore, otherwise the metadata provider's thumbnail.
   */
  coverUrl?: string | null;
  provider: string;
  inLibrary: boolean;
  existingBookId?: number | null;
  alreadyWanted: boolean;
  mediaInfo?: {
    id: number;
    status: number;
  } | null;
}

interface BookSearchResponse {
  results: BookSearchResult[];
}

/**
 * The books API distinguishes its failure modes with a machine readable code so
 * that a slow provider is never reported as a misconfiguration.
 */
type BookErrorCode =
  | 'BOOKLORE_NOT_CONFIGURED'
  | 'BOOKLORE_TIMEOUT'
  | 'BOOKLORE_SEARCH_FAILED';

interface BookErrorBody {
  message?: string;
  code?: BookErrorCode | string;
}

const getErrorBody = (error: unknown): BookErrorBody => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;

    if (data && typeof data === 'object') {
      return data as BookErrorBody;
    }
  }

  return {};
};

const getResultKey = (book: BookSearchResult): string =>
  book.isbn13 ??
  book.asin ??
  book.isbn10 ??
  `${book.provider}-${book.title}-${book.authors.join(',')}`;

const BookSearch = () => {
  const intl = useIntl();
  const { addToast } = useToasts();

  const [searchValue, setSearchValue] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [requestedKeys, setRequestedKeys] = useState<string[]>([]);
  const [selectedBook, setSelectedBook] = useState<BookSearchResult | null>(
    null
  );
  const [preferredFormat, setPreferredFormat] =
    useState<PreferredFormat>('ANY');
  const [isRequesting, setIsRequesting] = useState(false);

  // A lookup fans out to a dozen metadata providers and routinely takes the
  // better part of a minute, so the request only fires on an explicit submit.
  const {
    data,
    error,
    isValidating,
    mutate: revalidate,
  } = useSWR<BookSearchResponse>(
    submittedQuery
      ? `/api/v1/book/search?query=${encodeURIComponent(submittedQuery)}`
      : null,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      shouldRetryOnError: false,
      keepPreviousData: true,
    }
  );

  const errorBody = error ? getErrorBody(error) : undefined;
  const errorCode = errorBody?.code;
  const isNotConfigured = !!error && errorCode === 'BOOKLORE_NOT_CONFIGURED';
  const hasTimedOut = !!error && errorCode === 'BOOKLORE_TIMEOUT';
  const hasGenericError = !!error && !isNotConfigured && !hasTimedOut;

  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const trimmedQuery = searchValue.trim();

    if (!trimmedQuery || isValidating) {
      return;
    }

    if (trimmedQuery === submittedQuery) {
      // The key is unchanged, so SWR will not refetch on its own.
      revalidate();
      return;
    }

    setSubmittedQuery(trimmedQuery);
  };

  const requestBook = async () => {
    if (!selectedBook) {
      return;
    }

    setIsRequesting(true);

    try {
      await axios.post('/api/v1/request', {
        mediaType: 'book',
        title: selectedBook.title,
        author: selectedBook.authors[0] ?? undefined,
        isbn13: selectedBook.isbn13 ?? undefined,
        asin: selectedBook.asin ?? undefined,
        preferredFormat,
      });

      setRequestedKeys((keys) => [...keys, getResultKey(selectedBook)]);

      addToast(
        <span>
          {intl.formatMessage(messages.requestSuccess, {
            title: selectedBook.title,
            strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );

      mutate('/api/v1/book/wanted');
      setSelectedBook(null);
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;

      if (status === 409) {
        setRequestedKeys((keys) => [...keys, getResultKey(selectedBook)]);
        addToast(
          <span>
            {intl.formatMessage(messages.requestDuplicate, {
              title: selectedBook.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'info', autoDismiss: true }
        );
        setSelectedBook(null);
      } else if (status === 403) {
        addToast(intl.formatMessage(messages.requestPermissionDenied), {
          appearance: 'error',
          autoDismiss: true,
        });
      } else {
        addToast(intl.formatMessage(messages.requestError), {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } finally {
      setIsRequesting(false);
    }
  };

  const renderResults = () => {
    if (!submittedQuery && !data) {
      return (
        <div className="mt-16 w-full text-center text-2xl text-gray-400">
          {intl.formatMessage(messages.startSearching)}
        </div>
      );
    }

    if (!data) {
      return null;
    }

    if (!data.results.length) {
      return isValidating ? null : (
        <div className="mt-16 w-full text-center text-2xl text-gray-400">
          {intl.formatMessage(messages.nobooksfound)}
        </div>
      );
    }

    return (
      <ul
        className={`cards-vertical transition-opacity duration-300 ${
          isValidating ? 'opacity-50' : ''
        }`}
      >
        {data.results.map((book) => {
          const key = getResultKey(book);

          return (
            <li key={key}>
              <BookCard
                title={book.title}
                author={
                  book.authors.length
                    ? book.authors.join(', ')
                    : intl.formatMessage(messages.unknownAuthor)
                }
                bookloreBookId={book.existingBookId}
                coverUrl={book.coverUrl ?? book.thumbnailUrl}
                year={book.publishedYear}
                status={book.mediaInfo?.status as MediaStatus | undefined}
                inLibrary={book.inLibrary}
                isRequested={book.alreadyWanted || requestedKeys.includes(key)}
                onRequest={() => {
                  setPreferredFormat('ANY');
                  setSelectedBook(book);
                }}
                canExpand
              />
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <>
      {selectedBook && (
        <Modal
          backgroundClickable
          title={intl.formatMessage(messages.requestBook)}
          subTitle={selectedBook.title}
          onCancel={() => setSelectedBook(null)}
          cancelText={intl.formatMessage(globalMessages.cancel)}
          onOk={() => requestBook()}
          okText={
            isRequesting
              ? intl.formatMessage(globalMessages.requesting)
              : intl.formatMessage(globalMessages.request)
          }
          okDisabled={isRequesting}
          okButtonType="primary"
        >
          <div className="form-row">
            <label htmlFor="preferredFormat" className="text-label">
              {intl.formatMessage(messages.preferredFormat)}
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <select
                  id="preferredFormat"
                  name="preferredFormat"
                  value={preferredFormat}
                  onChange={(e) =>
                    setPreferredFormat(e.target.value as PreferredFormat)
                  }
                >
                  <option value="EBOOK">
                    {intl.formatMessage(messages.formatEbook)}
                  </option>
                  <option value="AUDIOBOOK">
                    {intl.formatMessage(messages.formatAudiobook)}
                  </option>
                  <option value="ANY">
                    {intl.formatMessage(messages.formatAny)}
                  </option>
                </select>
              </div>
            </div>
          </div>
        </Modal>
      )}

      <form className="mb-4 flex w-full lg:max-w-2xl" onSubmit={search}>
        <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-sm text-gray-100">
          <MagnifyingGlassIcon className="h-6 w-6" />
        </span>
        <input
          id="book-search"
          type="text"
          className="rounded-none border-r-0"
          placeholder={intl.formatMessage(messages.searchPlaceholder)}
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
        />
        <Button
          type="submit"
          buttonType="primary"
          className="rounded-l-none"
          disabled={isValidating || !searchValue.trim()}
        >
          <span>
            {isValidating
              ? intl.formatMessage(messages.searching)
              : intl.formatMessage(messages.search)}
          </span>
        </Button>
      </form>

      {isValidating && (
        <div className="mb-4 flex items-center space-x-3 rounded-xl bg-gray-800 p-4 text-gray-300 shadow-md ring-1 ring-gray-700">
          <div className="h-10 w-10 flex-shrink-0">
            <SmallLoadingSpinner />
          </div>
          <span>{intl.formatMessage(messages.searchInProgress)}</span>
        </div>
      )}

      {isNotConfigured ? (
        <div className="mt-16 flex w-full flex-col items-center justify-center text-center">
          <BookOpenIcon className="mb-4 h-12 w-12 text-gray-500" />
          <span className="text-2xl text-gray-400">
            {intl.formatMessage(messages.bookloreNotConfigured)}
          </span>
          <span className="mt-2 text-gray-500">
            {intl.formatMessage(messages.bookloreNotConfiguredDescription)}
          </span>
          <Link href="/settings/booklore" legacyBehavior>
            <Button as="a" buttonType="primary" className="mt-4">
              <span>{intl.formatMessage(messages.configureBooklore)}</span>
            </Button>
          </Link>
        </div>
      ) : hasTimedOut ? (
        <div className="mt-16 flex w-full flex-col items-center justify-center text-center">
          <ClockIcon className="mb-4 h-12 w-12 text-gray-500" />
          <span className="text-2xl text-gray-400">
            {intl.formatMessage(messages.bookloreTimedOut)}
          </span>
          <span className="mt-2 text-gray-500">
            {intl.formatMessage(messages.bookloreTimedOutDescription)}
          </span>
          <Button
            buttonType="primary"
            className="mt-4"
            disabled={isValidating}
            onClick={() => revalidate()}
          >
            <ArrowPathIcon />
            <span>{intl.formatMessage(globalMessages.retry)}</span>
          </Button>
        </div>
      ) : hasGenericError ? (
        <div className="mt-16 flex w-full flex-col items-center justify-center text-center">
          <ExclamationTriangleIcon className="mb-4 h-12 w-12 text-gray-500" />
          <span className="text-2xl text-gray-400">
            {intl.formatMessage(messages.bookloreSearchFailed)}
          </span>
          <span className="mt-2 text-gray-500">
            {errorBody?.message || intl.formatMessage(globalMessages.error)}
          </span>
          <Button
            buttonType="primary"
            className="mt-4"
            disabled={isValidating}
            onClick={() => revalidate()}
          >
            <ArrowPathIcon />
            <span>{intl.formatMessage(globalMessages.retry)}</span>
          </Button>
        </div>
      ) : (
        renderResults()
      )}
    </>
  );
};

export default BookSearch;
