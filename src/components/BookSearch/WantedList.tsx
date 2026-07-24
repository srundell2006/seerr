import Badge from '@app/components/Common/Badge';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.BookSearch', {
  wantedbooks: 'Wanted Books',
  nowantedbooks: 'There are no books on the wanted list.',
  statusWanted: 'Wanted',
  statusGrabbed: 'Grabbed',
  statusImported: 'Imported',
  statusFailed: 'Failed',
  grabbedrelease: 'Release: {release}',
  failurereason: 'Reason: {reason}',
  unknownAuthor: 'Unknown Author',
});

export type WantedBookStatus = 'WANTED' | 'GRABBED' | 'IMPORTED' | 'FAILED';

export interface WantedBook {
  id: number;
  title: string;
  author?: string | null;
  isbn13?: string | null;
  asin?: string | null;
  status: WantedBookStatus;
  grabbedReleaseTitle?: string | null;
  failureReason?: string | null;
  addedAt: string;
}

interface WantedBooksResponse {
  results: WantedBook[];
}

const WantedList = () => {
  const intl = useIntl();

  const { data, error, isLoading } = useSWR<WantedBooksResponse>(
    '/api/v1/book/wanted',
    {
      refreshInterval: 30000,
      shouldRetryOnError: false,
    }
  );

  const statusBadge = (status: WantedBookStatus) => {
    switch (status) {
      case 'IMPORTED':
        return (
          <Badge badgeType="success">
            {intl.formatMessage(messages.statusImported)}
          </Badge>
        );
      case 'GRABBED':
        return (
          <Badge badgeType="warning">
            {intl.formatMessage(messages.statusGrabbed)}
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge badgeType="danger">
            {intl.formatMessage(messages.statusFailed)}
          </Badge>
        );
      default:
        return (
          <Badge badgeType="primary">
            {intl.formatMessage(messages.statusWanted)}
          </Badge>
        );
    }
  };

  if (error) {
    return null;
  }

  return (
    <div className="mt-8">
      <div className="mb-4 text-xl font-bold text-gray-100">
        {intl.formatMessage(messages.wantedbooks)}
      </div>
      {isLoading && !data ? (
        <LoadingSpinner />
      ) : !data?.results.length ? (
        <div className="w-full text-center text-gray-400">
          {intl.formatMessage(messages.nowantedbooks)}
        </div>
      ) : (
        <ul className="space-y-2">
          {data.results.map((book) => (
            <li
              key={book.id}
              className="flex w-full items-start justify-between space-x-4 rounded-xl bg-gray-800 p-4 text-gray-400 shadow-md ring-1 ring-gray-700"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold text-white">
                  {book.title}
                </div>
                <div className="truncate text-sm text-gray-300">
                  {book.author || intl.formatMessage(messages.unknownAuthor)}
                </div>
                {book.grabbedReleaseTitle && (
                  <div className="mt-1 truncate text-sm text-gray-400">
                    {intl.formatMessage(messages.grabbedrelease, {
                      release: book.grabbedReleaseTitle,
                    })}
                  </div>
                )}
                {book.status === 'FAILED' && book.failureReason && (
                  <div className="mt-1 text-sm text-red-400">
                    {intl.formatMessage(messages.failurereason, {
                      reason: book.failureReason,
                    })}
                  </div>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center space-x-2">
                <span className="hidden text-sm text-gray-400 sm:block">
                  {intl.formatDate(book.addedAt, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
                {statusBadge(book.status)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default WantedList;
