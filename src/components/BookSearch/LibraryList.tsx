import BookCard from '@app/components/BookSearch/BookCard';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import useDebouncedState from '@app/hooks/useDebouncedState';
import { useUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid';
import type { MediaStatus } from '@server/constants/media';
import { useRouter } from 'next/router';
import type { ChangeEvent } from 'react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.BookSearch.LibraryList', {
  librarysearchPlaceholder: 'Filter the library by title or author',
  libraryempty: 'Your BookLore library has not been synced yet.',
  libraryemptyDescription:
    'The BookLore library scan runs periodically and will populate this list once it has completed.',
  librarynoresults: 'No books in the library match your search.',
  libraryError: 'The BookLore library could not be loaded.',
});

export interface BookLibraryItem {
  id: number;
  bookloreBookId?: number | null;
  title?: string | null;
  author?: string | null;
  isbn13?: string | null;
  asin?: string | null;
  thumbnailUrl?: string | null;
  /** Ready-to-render cover URL, e.g. "/api/v1/book/cover/171987". */
  coverUrl?: string | null;
  status: number;
}

interface BookLibraryResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: BookLibraryItem[];
}

const LibraryList = () => {
  const intl = useIntl();
  const router = useRouter();

  const [currentPageSize, setCurrentPageSize] = useState<number>(10);
  const [searchFilter, debouncedSearchFilter, setSearchFilter] =
    useDebouncedState('');

  const page = router.query.page ? Number(router.query.page) : 1;
  const pageIndex = page - 1;
  const updateQueryParams = useUpdateQueryParams({ page: page.toString() });

  const { data, error } = useSWR<BookLibraryResponse>(
    `/api/v1/book/library?take=${currentPageSize}&skip=${
      pageIndex * currentPageSize
    }${
      debouncedSearchFilter
        ? `&search=${encodeURIComponent(debouncedSearchFilter)}`
        : ''
    }`,
    {
      revalidateOnFocus: false,
    }
  );

  const searchItem = (e: ChangeEvent<HTMLInputElement>) => {
    // Reset to the first page so that the "skip" parameter does not push the
    // (usually much smaller) filtered result set out of view.
    if (page > 1) {
      updateQueryParams('page', '1');
    }

    setSearchFilter(e.target.value);
  };

  if (!data && error) {
    return (
      <div className="mt-16 w-full text-center text-2xl text-gray-400">
        {intl.formatMessage(messages.libraryError)}
      </div>
    );
  }

  const hasNextPage = data && data.pageInfo.pages > pageIndex + 1;
  const hasPrevPage = pageIndex > 0;

  return (
    <>
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <div className="flex flex-grow lg:max-w-md lg:flex-grow-0">
          <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-sm text-gray-100">
            <MagnifyingGlassIcon className="h-6 w-6" />
          </span>
          <input
            id="book-library-search"
            type="text"
            className="rounded-r-only"
            placeholder={intl.formatMessage(messages.librarysearchPlaceholder)}
            value={searchFilter}
            onChange={(e) => searchItem(e)}
          />
        </div>
      </div>

      {!data ? (
        <LoadingSpinner />
      ) : !data.results.length ? (
        <div className="flex w-full flex-col items-center justify-center py-24 text-center">
          <span className="text-2xl text-gray-400">
            {intl.formatMessage(
              debouncedSearchFilter
                ? messages.librarynoresults
                : messages.libraryempty
            )}
          </span>
          {!debouncedSearchFilter && (
            <span className="mt-2 text-gray-500">
              {intl.formatMessage(messages.libraryemptyDescription)}
            </span>
          )}
        </div>
      ) : (
        <ul className="cards-vertical">
          {data.results.map((book) => (
            <li key={`book-library-${book.id}`}>
              <BookCard
                title={book.title || intl.formatMessage(globalMessages.book)}
                author={book.author}
                coverUrl={book.coverUrl ?? book.thumbnailUrl}
                status={book.status as MediaStatus}
                inLibrary
                canExpand
              />
            </li>
          ))}
        </ul>
      )}

      <div className="actions">
        <nav
          className="mb-3 flex flex-col items-center space-y-3 sm:flex-row sm:space-y-0"
          aria-label="Pagination"
        >
          <div className="hidden lg:flex lg:flex-1">
            <p className="text-sm">
              {data &&
                data.results.length > 0 &&
                intl.formatMessage(globalMessages.showingresults, {
                  from: pageIndex * currentPageSize + 1,
                  to:
                    data.results.length < currentPageSize
                      ? pageIndex * currentPageSize + data.results.length
                      : (pageIndex + 1) * currentPageSize,
                  total: data.pageInfo.results,
                  strong: (msg: React.ReactNode) => (
                    <span className="font-medium">{msg}</span>
                  ),
                })}
            </p>
          </div>
          <div className="flex justify-center sm:flex-1 sm:justify-start lg:justify-center">
            <span className="-mt-3 items-center truncate text-sm sm:mt-0">
              {intl.formatMessage(globalMessages.resultsperpage, {
                pageSize: (
                  <select
                    id="pageSize"
                    name="pageSize"
                    onChange={(e) => {
                      setCurrentPageSize(Number(e.target.value));
                      if (page > 1) {
                        updateQueryParams('page', '1');
                      }
                      window.scrollTo(0, 0);
                    }}
                    value={currentPageSize}
                    className="short inline"
                  >
                    <option value="5">5</option>
                    <option value="10">10</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                ),
              })}
            </span>
          </div>
          <div className="flex flex-auto justify-center space-x-2 sm:flex-1 sm:justify-end">
            <Button
              disabled={!hasPrevPage}
              onClick={() => updateQueryParams('page', (page - 1).toString())}
            >
              <ChevronLeftIcon />
              <span>{intl.formatMessage(globalMessages.previous)}</span>
            </Button>
            <Button
              disabled={!hasNextPage}
              onClick={() => updateQueryParams('page', (page + 1).toString())}
            >
              <span>{intl.formatMessage(globalMessages.next)}</span>
              <ChevronRightIcon />
            </Button>
          </div>
        </nav>
      </div>
    </>
  );
};

export default LibraryList;
