import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import StatusBadge from '@app/components/StatusBadge';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { BookOpenIcon } from '@heroicons/react/24/solid';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import { useRouter } from 'next/router';
import { Fragment, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.BookDetails', {
  description: 'Description',
  descriptionunavailable: 'No description available.',
  openinbooklore: 'Open in BookLore',
  inbooklore: 'In BookLore Library',
  unknownauthor: 'Unknown Author',
  publisher: 'Publisher',
  publisheddate: 'Published',
  pagecount: 'Page Count',
  pages: '{pageCount, plural, one {# page} other {# pages}}',
  language: 'Language',
  series: 'Series',
  seriesposition: '{seriesName} #{seriesNumber}',
  seriespositionoftotal: '{seriesName} #{seriesNumber} of {seriesTotal}',
  categories: 'Categories',
  isbn13: 'ISBN-13',
  isbn10: 'ISBN-10',
  asin: 'ASIN',
  library: 'Library',
  filename: 'File Name',
  filesize: 'File Size',
  fileformat: 'Format',
  filesizemb: '{size} MB',
  addedon: 'Added',
  comic: 'Comic',
  amazonrating: 'Amazon',
  goodreadsrating: 'Goodreads',
  hardcoverrating: 'Hardcover',
  requests: 'Requests',
  unknownrequester: 'Unknown User',
  formatEbook: 'Ebook',
  formatAudiobook: 'Audiobook',
  formatAny: 'Either',
});

export interface BookDetailsRequest {
  id: number;
  status: number;
  createdAt: string;
  bookFormat: string | null;
  requestedBy: {
    id: number;
    displayName: string;
  } | null;
}

export interface BookDetailsType {
  bookloreBookId: number;
  id: number | null;
  title: string | null;
  subtitle: string | null;
  authors: string[];
  description: string | null;
  publisher: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  language: string | null;
  seriesName: string | null;
  seriesNumber: number | null;
  seriesTotal: number | null;
  categories: string[];
  isbn13: string | null;
  isbn10: string | null;
  asin: string | null;
  ratings: {
    amazon: number | null;
    goodreads: number | null;
    hardcover: number | null;
  };
  file: {
    fileName: string | null;
    fileSizeKb: number | null;
    bookType: string | null;
  } | null;
  libraryName: string | null;
  isComic: boolean;
  addedOn: string | null;
  coverUrl: string;
  externalUrl: string;
  mediaInfo: {
    id: number;
    status: number;
  } | null;
  requests: BookDetailsRequest[];
}

interface BookDetailsProps {
  book?: BookDetailsType;
}

const requestBadgeType = (status: number) => {
  switch (status) {
    case MediaRequestStatus.COMPLETED:
      return 'success';
    case MediaRequestStatus.APPROVED:
      return 'primary';
    case MediaRequestStatus.DECLINED:
    case MediaRequestStatus.FAILED:
      return 'danger';
    default:
      return 'warning';
  }
};

const BookDetails = ({ book }: BookDetailsProps) => {
  const intl = useIntl();
  const router = useRouter();
  const [hasCoverError, setHasCoverError] = useState(false);

  const { data, error } = useSWR<BookDetailsType>(
    `/api/v1/book/${router.query.bookId}`,
    {
      fallbackData: book,
      revalidateOnFocus: false,
    }
  );

  // A route change swaps in a different book under the same component, so a
  // stale error must not blank out the new cover.
  useEffect(() => {
    setHasCoverError(false);
  }, [data?.coverUrl]);

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={404} />;
  }

  const title = data.title ?? intl.formatMessage(globalMessages.book);
  const authorLabel = data.authors.length
    ? data.authors.join(', ')
    : intl.formatMessage(messages.unknownauthor);
  const showCover = !hasCoverError;

  const seriesLabel = data.seriesName
    ? data.seriesNumber
      ? intl.formatMessage(
          data.seriesTotal
            ? messages.seriespositionoftotal
            : messages.seriesposition,
          {
            seriesName: data.seriesName,
            seriesNumber: data.seriesNumber,
            seriesTotal: data.seriesTotal,
          }
        )
      : data.seriesName
    : null;

  // Books carry a handful of the attributes a movie does, so the same
  // pipe-delimited header line is built from whatever happens to be present.
  const bookAttributes: React.ReactNode[] = [];

  bookAttributes.push(authorLabel);

  if (seriesLabel) {
    bookAttributes.push(seriesLabel);
  }

  if (data.pageCount) {
    bookAttributes.push(
      intl.formatMessage(messages.pages, { pageCount: data.pageCount })
    );
  }

  if (data.isComic) {
    bookAttributes.push(intl.formatMessage(messages.comic));
  }

  const ratings = [
    {
      key: 'amazon',
      label: messages.amazonrating,
      value: data.ratings.amazon,
    },
    {
      key: 'goodreads',
      label: messages.goodreadsrating,
      value: data.ratings.goodreads,
    },
    {
      key: 'hardcover',
      label: messages.hardcoverrating,
      value: data.ratings.hardcover,
    },
  ].filter(
    (rating): rating is typeof rating & { value: number } =>
      typeof rating.value === 'number'
  );

  const bookFormatLabel = (bookFormat: string | null) => {
    switch (bookFormat) {
      case 'EBOOK':
        return intl.formatMessage(messages.formatEbook);
      case 'AUDIOBOOK':
        return intl.formatMessage(messages.formatAudiobook);
      case 'ANY':
        return intl.formatMessage(messages.formatAny);
      default:
        return bookFormat;
    }
  };

  const requestStatusLabel = (status: number) => {
    switch (status) {
      case MediaRequestStatus.COMPLETED:
        return intl.formatMessage(globalMessages.completed);
      case MediaRequestStatus.APPROVED:
        return intl.formatMessage(globalMessages.approved);
      case MediaRequestStatus.DECLINED:
        return intl.formatMessage(globalMessages.declined);
      case MediaRequestStatus.FAILED:
        return intl.formatMessage(globalMessages.failed);
      default:
        return intl.formatMessage(globalMessages.pending);
    }
  };

  return (
    <div
      className="media-page"
      style={{
        height: 493,
      }}
    >
      {/*
        Books have no backdrop of their own, so the cover stands in for one:
        blown up, blurred and dimmed under the same gradient the movie page
        uses. Without artwork the gradient alone carries the region.
      */}
      <div className="media-page-bg-image">
        {showCover && (
          <CachedImage
            // Book covers are served same-origin through the Seerr proxy.
            type="avatar"
            alt=""
            src={data.coverUrl}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
            className="scale-125 blur-2xl"
            fill
            priority
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(180deg, rgba(17, 24, 39, 0.47) 0%, rgba(17, 24, 39, 1) 100%)',
          }}
        />
      </div>
      <PageTitle title={title} />
      <div className="media-header">
        <div className="media-poster">
          <div className="relative" style={{ paddingBottom: '150%' }}>
            {showCover ? (
              <CachedImage
                type="avatar"
                alt=""
                src={data.coverUrl}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                fill
                priority
                onError={() => setHasCoverError(true)}
              />
            ) : (
              // The library ships plenty of books without artwork, so the
              // fallback is a deliberate cover of its own at the same ratio.
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-gray-700 to-gray-900 px-3 py-6 text-center">
                <BookOpenIcon className="mb-3 h-10 w-10 flex-shrink-0 text-gray-500" />
                <span
                  className="whitespace-normal text-sm font-semibold leading-snug text-gray-200"
                  style={{
                    WebkitLineClamp: 4,
                    display: '-webkit-box',
                    overflow: 'hidden',
                    WebkitBoxOrient: 'vertical',
                    wordBreak: 'break-word',
                  }}
                >
                  {title}
                </span>
                <span
                  className="mt-1 whitespace-normal text-xs leading-snug text-gray-500"
                  style={{
                    WebkitLineClamp: 2,
                    display: '-webkit-box',
                    overflow: 'hidden',
                    WebkitBoxOrient: 'vertical',
                    wordBreak: 'break-word',
                  }}
                >
                  {authorLabel}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="media-title">
          <div className="media-status">
            {data.mediaInfo?.status &&
            data.mediaInfo.status !== MediaStatus.UNKNOWN ? (
              <StatusBadge status={data.mediaInfo.status} title={title} />
            ) : (
              // Reaching this page at all means BookLore holds the book, even
              // when Seerr is not tracking it as media of its own.
              <Badge badgeType="success">
                {intl.formatMessage(messages.inbooklore)}
              </Badge>
            )}
          </div>
          <h1 data-testid="book-title">
            {title}{' '}
            {data.publishedYear && (
              <span className="media-year">({data.publishedYear})</span>
            )}
          </h1>
          <span className="media-attributes">
            {bookAttributes.length > 0 &&
              bookAttributes
                .map((attribute, index) => <span key={index}>{attribute}</span>)
                .reduce((prev, curr) => (
                  <Fragment key={`${prev.key}-${curr.key}`}>
                    {prev}
                    <span>|</span>
                    {curr}
                  </Fragment>
                ))}
          </span>
        </div>
        <div className="media-actions">
          <Button
            as="a"
            href={data.externalUrl}
            target="_blank"
            rel="noreferrer"
            buttonType="primary"
          >
            <ArrowTopRightOnSquareIcon />
            <span>{intl.formatMessage(messages.openinbooklore)}</span>
          </Button>
        </div>
      </div>
      <div className="media-overview">
        <div className="media-overview-left">
          {data.subtitle && <div className="tagline">{data.subtitle}</div>}
          <h2>{intl.formatMessage(messages.description)}</h2>
          {data.description ? (
            <p className="whitespace-pre-line">{data.description}</p>
          ) : (
            // Most BookLore metadata providers return no description at all,
            // so the gap gets a deliberate treatment instead of empty space.
            <div className="mt-3 flex items-center rounded-lg border border-dashed border-gray-700 bg-gray-800/40 px-4 py-6 text-sm italic text-gray-500">
              <BookOpenIcon className="mr-3 h-6 w-6 flex-shrink-0 text-gray-600" />
              <span>{intl.formatMessage(messages.descriptionunavailable)}</span>
            </div>
          )}
          {data.requests.length > 0 && (
            <>
              <h2 className="mt-8">{intl.formatMessage(messages.requests)}</h2>
              <ul className="mt-3 divide-y divide-gray-700 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow">
                {data.requests.map((request) => (
                  <li
                    key={`book-request-${request.id}`}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-200">
                        {request.requestedBy?.displayName ??
                          intl.formatMessage(messages.unknownrequester)}
                      </span>
                      <span className="text-xs text-gray-400">
                        {intl.formatDate(request.createdAt, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                        {request.bookFormat
                          ? ` • ${bookFormatLabel(request.bookFormat)}`
                          : ''}
                      </span>
                    </div>
                    <Badge badgeType={requestBadgeType(request.status)}>
                      {requestStatusLabel(request.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="media-overview-right">
          <div className="media-facts">
            {ratings.length > 0 && (
              <div className="media-ratings">
                {ratings.map((rating) => (
                  <span
                    key={`book-rating-${rating.key}`}
                    className="flex flex-col items-center"
                  >
                    <span className="text-sm font-bold text-gray-200">
                      {intl.formatNumber(rating.value, {
                        maximumFractionDigits: 1,
                      })}
                    </span>
                    <span className="text-xs font-normal text-gray-400">
                      {intl.formatMessage(rating.label)}
                    </span>
                  </span>
                ))}
              </div>
            )}
            {data.publisher && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.publisher)}</span>
                <span className="media-fact-value">{data.publisher}</span>
              </div>
            )}
            {data.publishedDate && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.publisheddate)}</span>
                <span className="media-fact-value">
                  {intl.formatDate(data.publishedDate, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                </span>
              </div>
            )}
            {seriesLabel && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.series)}</span>
                <span className="media-fact-value">{seriesLabel}</span>
              </div>
            )}
            {!!data.pageCount && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.pagecount)}</span>
                <span className="media-fact-value">
                  {intl.formatNumber(data.pageCount)}
                </span>
              </div>
            )}
            {data.language && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.language)}</span>
                <span className="media-fact-value">
                  {intl.formatDisplayName(data.language, {
                    type: 'language',
                    fallback: 'none',
                  }) ?? data.language}
                </span>
              </div>
            )}
            {data.isbn13 && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.isbn13)}</span>
                <span className="media-fact-value">{data.isbn13}</span>
              </div>
            )}
            {data.isbn10 && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.isbn10)}</span>
                <span className="media-fact-value">{data.isbn10}</span>
              </div>
            )}
            {data.asin && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.asin)}</span>
                <span className="media-fact-value">{data.asin}</span>
              </div>
            )}
            {data.categories.length > 0 && (
              <div className="media-fact flex-col gap-1">
                <span>{intl.formatMessage(messages.categories)}</span>
                <span className="media-fact-value flex flex-row flex-wrap justify-start gap-2">
                  {data.categories.map((category) => (
                    <Badge key={`book-category-${category}`} badgeType="light">
                      {category}
                    </Badge>
                  ))}
                </span>
              </div>
            )}
            {data.libraryName && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.library)}</span>
                <span className="media-fact-value">{data.libraryName}</span>
              </div>
            )}
            {data.file?.bookType && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.fileformat)}</span>
                <span className="media-fact-value">{data.file.bookType}</span>
              </div>
            )}
            {!!data.file?.fileSizeKb && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.filesize)}</span>
                <span className="media-fact-value">
                  {intl.formatMessage(messages.filesizemb, {
                    size: intl.formatNumber(data.file.fileSizeKb / 1024, {
                      maximumFractionDigits: 1,
                    }),
                  })}
                </span>
              </div>
            )}
            {data.file?.fileName && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.filename)}</span>
                <span className="media-fact-value break-all">
                  {data.file.fileName}
                </span>
              </div>
            )}
            {data.addedOn && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.addedon)}</span>
                <span className="media-fact-value">
                  {intl.formatDate(data.addedOn, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="extra-bottom-space relative" />
    </div>
  );
};

export default BookDetails;
