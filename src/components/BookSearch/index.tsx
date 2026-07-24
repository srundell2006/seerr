import WantedList from '@app/components/BookSearch/WantedList';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { BookOpenIcon, MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import { MediaStatus } from '@server/constants/media';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.BookSearch', {
  books: 'Books',
  searchPlaceholder: 'Search for books by title, author, or ISBN',
  startSearching: 'Start typing to search for books.',
  nobooksfound: 'No books found.',
  bookloreNotConfigured: 'BookLore is not configured.',
  bookloreNotConfiguredDescription:
    'Books cannot be searched or requested until BookLore has been set up.',
  configureBooklore: 'Configure BookLore',
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

const getResultKey = (book: BookSearchResult): string =>
  book.isbn13 ??
  book.asin ??
  book.isbn10 ??
  `${book.provider}-${book.title}-${book.authors.join(',')}`;

const BookThumbnail = ({ book }: { book: BookSearchResult }) => {
  const [hasError, setHasError] = useState(false);

  if (!book.thumbnailUrl || hasError) {
    return (
      <div className="flex h-28 w-20 flex-shrink-0 items-center justify-center rounded-md bg-gray-700 text-gray-500 ring-1 ring-gray-600">
        <BookOpenIcon className="h-8 w-8" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={book.thumbnailUrl}
      alt=""
      className="h-28 w-20 flex-shrink-0 rounded-md object-cover ring-1 ring-gray-600"
      onError={() => setHasError(true)}
    />
  );
};

const BookSearch = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { hasPermission } = useUser();

  const [searchValue, debouncedSearchValue, setSearchValue] = useDebouncedState(
    '',
    400
  );
  const [requestedKeys, setRequestedKeys] = useState<string[]>([]);
  const [selectedBook, setSelectedBook] = useState<BookSearchResult | null>(
    null
  );
  const [preferredFormat, setPreferredFormat] =
    useState<PreferredFormat>('ANY');
  const [isRequesting, setIsRequesting] = useState(false);

  const trimmedQuery = debouncedSearchValue.trim();

  const { data, error, isLoading } = useSWR<BookSearchResponse>(
    trimmedQuery
      ? `/api/v1/search/books?query=${encodeURIComponent(trimmedQuery)}`
      : null,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  const canRequest = hasPermission(Permission.REQUEST_BOOK);
  // The books search endpoint responds with a 500 when BookLore has not been
  // set up yet, which we surface as a dedicated empty state.
  const isNotConfigured =
    !!error && (!axios.isAxiosError(error) || error.response?.status === 500);
  const hasError = !!error && !isNotConfigured;

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

  const renderStatus = (book: BookSearchResult) => {
    const status = book.mediaInfo?.status;

    if (
      book.inLibrary ||
      status === MediaStatus.AVAILABLE ||
      status === MediaStatus.PARTIALLY_AVAILABLE
    ) {
      return (
        <Badge badgeType="success">
          {intl.formatMessage(globalMessages.available)}
        </Badge>
      );
    }

    if (
      book.alreadyWanted ||
      requestedKeys.includes(getResultKey(book)) ||
      status === MediaStatus.PENDING ||
      status === MediaStatus.PROCESSING
    ) {
      return (
        <Badge badgeType="primary">
          {intl.formatMessage(globalMessages.requested)}
        </Badge>
      );
    }

    if (!canRequest) {
      return null;
    }

    return (
      <Button
        buttonType="primary"
        buttonSize="sm"
        onClick={() => {
          setPreferredFormat('ANY');
          setSelectedBook(book);
        }}
      >
        <BookOpenIcon />
        <span>{intl.formatMessage(globalMessages.request)}</span>
      </Button>
    );
  };

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.books)} />
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
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <Header>{intl.formatMessage(messages.books)}</Header>
        <div className="mt-2 flex flex-grow lg:mt-0 lg:max-w-md lg:flex-grow-0">
          <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-sm text-gray-100">
            <MagnifyingGlassIcon className="h-6 w-6" />
          </span>
          <input
            id="book-search"
            type="text"
            className="rounded-r-only"
            placeholder={intl.formatMessage(messages.searchPlaceholder)}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
          />
        </div>
      </div>

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
      ) : hasError ? (
        <div className="mt-16 w-full text-center text-2xl text-gray-400">
          {intl.formatMessage(globalMessages.error)}
        </div>
      ) : !trimmedQuery ? (
        <div className="mt-16 w-full text-center text-2xl text-gray-400">
          {intl.formatMessage(messages.startSearching)}
        </div>
      ) : isLoading ? (
        <LoadingSpinner />
      ) : !data?.results.length ? (
        <div className="mt-16 w-full text-center text-2xl text-gray-400">
          {intl.formatMessage(messages.nobooksfound)}
        </div>
      ) : (
        <ul className="space-y-4">
          {data.results.map((book) => (
            <li
              key={getResultKey(book)}
              className="flex w-full items-start space-x-4 rounded-xl bg-gray-800 p-4 text-gray-400 shadow-md ring-1 ring-gray-700"
            >
              <BookThumbnail book={book} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-bold text-white">
                  {book.title}
                </div>
                <div className="truncate text-sm text-gray-300">
                  {book.authors.length
                    ? book.authors.join(', ')
                    : intl.formatMessage(messages.unknownAuthor)}
                </div>
                {(book.publisher || book.publishedYear) && (
                  <div className="truncate text-sm text-gray-400">
                    {[book.publisher, book.publishedYear]
                      .filter(Boolean)
                      .join(' • ')}
                  </div>
                )}
                <div className="mt-2">
                  <Badge badgeType="light">{book.provider}</Badge>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center">
                {renderStatus(book)}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!isNotConfigured && <WantedList />}
    </>
  );
};

export default BookSearch;
