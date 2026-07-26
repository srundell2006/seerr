import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import { useIsTouch } from '@app/hooks/useIsTouch';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { BookOpenIcon } from '@heroicons/react/24/solid';
import { MediaStatus } from '@server/constants/media';
import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.BookSearch.BookCard', {
  unknownAuthor: 'Unknown Author',
});

interface BookCardProps {
  title: string;
  author?: string | null;
  /**
   * BookLore's id for the book, which makes the card navigable. Derived from
   * `coverUrl` when omitted.
   */
  bookloreBookId?: number | null;
  /**
   * Ready-to-render cover URL. Same-origin for anything BookLore already has
   * ("/api/v1/book/cover/123"), otherwise the metadata provider's thumbnail.
   */
  coverUrl?: string | null;
  year?: string | number | null;
  status?: MediaStatus;
  /** The book is already in the BookLore library. */
  inLibrary?: boolean;
  /** The book has been requested (including an optimistic local flip). */
  isRequested?: boolean;
  /** Omitted for library items, which can never be requested. */
  onRequest?: () => void;
  canExpand?: boolean;
}

const BookCard = ({
  title,
  author,
  bookloreBookId,
  coverUrl,
  year,
  status,
  inLibrary = false,
  isRequested = false,
  onRequest,
  canExpand = false,
}: BookCardProps) => {
  const intl = useIntl();
  const isTouch = useIsTouch();
  const { hasPermission } = useUser();
  const [showDetail, setShowDetail] = useState(false);
  const [hasCoverError, setHasCoverError] = useState(false);

  // A different card can be recycled into this slot when the page or the query
  // changes, so a stale error must not blank out the new cover.
  useEffect(() => {
    setHasCoverError(false);
  }, [coverUrl]);

  // The library and search endpoints report presence/interest with separate
  // flags, so fold them into the same MediaStatus the movie grid renders.
  let currentStatus = status;

  if (!currentStatus || currentStatus === MediaStatus.UNKNOWN) {
    if (inLibrary) {
      currentStatus = MediaStatus.AVAILABLE;
    } else if (isRequested) {
      currentStatus = MediaStatus.PENDING;
    }
  }

  const showRequestButton =
    !!onRequest &&
    hasPermission(Permission.REQUEST_BOOK) &&
    (!currentStatus ||
      currentStatus === MediaStatus.UNKNOWN ||
      currentStatus === MediaStatus.DELETED);

  const showCover = !!coverUrl && !hasCoverError;
  const authorLabel = author || intl.formatMessage(messages.unknownAuthor);
  const detailId = bookloreBookId ?? null;

  // Only the overlay is the link, exactly as TitleCard does it: on touch the
  // first tap reveals the overlay and the second one navigates.
  const detailContent = (
    <div className="flex h-full w-full items-end">
      <div
        className={`px-2 text-white ${showRequestButton ? 'pb-11' : 'pb-2'}`}
      >
        {year && <div className="text-sm font-medium">{year}</div>}
        <h2
          className="whitespace-normal text-xl font-bold leading-tight"
          style={{
            WebkitLineClamp: 3,
            display: '-webkit-box',
            overflow: 'hidden',
            WebkitBoxOrient: 'vertical',
            wordBreak: 'break-word',
          }}
          data-testid="book-card-title"
        >
          {title}
        </h2>
        <div
          className="whitespace-normal text-xs"
          style={{
            WebkitLineClamp: showRequestButton ? 3 : 5,
            display: '-webkit-box',
            overflow: 'hidden',
            WebkitBoxOrient: 'vertical',
            wordBreak: 'break-word',
          }}
        >
          {authorLabel}
        </div>
      </div>
    </div>
  );

  const detailBackground =
    'linear-gradient(180deg, rgba(45, 55, 72, 0.4) 0%, rgba(45, 55, 72, 0.9) 100%)';

  return (
    <div
      className={canExpand ? 'w-full' : 'w-36 sm:w-36 md:w-44'}
      data-testid="book-card"
    >
      <div
        className={`relative transform-gpu cursor-default overflow-hidden rounded-xl bg-gray-800 bg-cover outline-none ring-1 transition duration-300 ${
          showDetail
            ? 'scale-105 shadow-lg ring-gray-500'
            : 'scale-100 shadow ring-gray-700'
        }`}
        style={{
          paddingBottom: '150%',
        }}
        onMouseEnter={() => {
          if (!isTouch) {
            setShowDetail(true);
          }
        }}
        onMouseLeave={() => setShowDetail(false)}
        onClick={() => setShowDetail(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setShowDetail(true);
          }
        }}
        role={detailId ? 'link' : 'button'}
        tabIndex={0}
      >
        <div className="absolute inset-0 h-full w-full overflow-hidden">
          {showCover ? (
            <CachedImage
              // Book covers are either same-origin or already-public provider
              // thumbnails, so they are served as-is rather than proxied.
              type="avatar"
              className="absolute inset-0 h-full w-full"
              alt=""
              src={coverUrl}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              fill
              onError={() => setHasCoverError(true)}
            />
          ) : (
            // A large share of the library ships without artwork, so the
            // fallback is a deliberate cover of its own at the same ratio.
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-gray-700 to-gray-900 px-3 pb-8 pt-10 text-center">
              <BookOpenIcon className="mb-3 h-10 w-10 flex-shrink-0 text-gray-500" />
              <span
                className="whitespace-normal text-xs font-semibold leading-snug text-gray-200"
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
          <div className="absolute left-0 right-0 flex items-center justify-between p-2">
            <div className="pointer-events-none z-40 self-start rounded-full border border-amber-500 bg-amber-600/80 shadow-md">
              <div className="flex h-4 items-center px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-white sm:h-5">
                {intl.formatMessage(globalMessages.book)}
              </div>
            </div>
            {currentStatus && currentStatus !== MediaStatus.UNKNOWN && (
              <div className="flex flex-col items-center gap-1">
                <div className="pointer-events-none z-40 flex">
                  <StatusBadgeMini status={currentStatus} shrink />
                </div>
              </div>
            )}
          </div>

          <Transition
            as={Fragment}
            show={showDetail}
            enter="transition-opacity"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="absolute inset-0 overflow-hidden rounded-xl">
              {detailId ? (
                <Link
                  href={`/book/${detailId}`}
                  className="absolute inset-0 h-full w-full cursor-pointer overflow-hidden text-left"
                  style={{ background: detailBackground }}
                >
                  {detailContent}
                </Link>
              ) : (
                <div
                  className="absolute inset-0 h-full w-full overflow-hidden text-left"
                  style={{ background: detailBackground }}
                >
                  {detailContent}
                </div>
              )}

              {/* Sits above the link so requesting never navigates. */}
              <div className="absolute bottom-0 left-0 right-0 z-40 flex justify-between px-2 py-2">
                {showRequestButton && (
                  <Button
                    buttonType="primary"
                    buttonSize="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRequest?.();
                    }}
                    className="h-7 w-full"
                  >
                    <ArrowDownTrayIcon />
                    <span>{intl.formatMessage(globalMessages.request)}</span>
                  </Button>
                )}
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  );
};

export default BookCard;
