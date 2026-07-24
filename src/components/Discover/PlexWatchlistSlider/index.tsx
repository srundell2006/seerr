import Slider from '@app/components/Slider';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { isTmdbWatchlistItem } from '@app/utils/mediaType';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import type { WatchlistItem } from '@server/interfaces/api/discoverInterfaces';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.PlexWatchlistSlider', {
  plexwatchlist: 'Your Watchlist',
  emptywatchlist:
    'Media added to your <PlexWatchlistSupportLink>Plex Watchlist</PlexWatchlistSupportLink> will appear here.',
});

const PlexWatchlistSlider = () => {
  const intl = useIntl();
  const { user } = useUser();

  const { data: watchlistItems, error: watchlistError } = useSWR<{
    page: number;
    totalPages: number;
    totalResults: number;
    results: WatchlistItem[];
  }>('/api/v1/discover/watchlist', {
    revalidateOnMount: true,
  });

  // Books have no TMDB title card and live on /books, so they never belong in
  // this slider — drop them before any count or empty state is derived.
  const tmdbWatchlistItems =
    watchlistItems?.results.filter(isTmdbWatchlistItem);

  if (
    (tmdbWatchlistItems &&
      tmdbWatchlistItems.length === 0 &&
      !user?.settings?.watchlistSyncMovies &&
      !user?.settings?.watchlistSyncTv) ||
    watchlistError
  ) {
    return null;
  }

  return (
    <>
      <div className="slider-header">
        <Link href="/discover/watchlist" className="slider-title">
          <span>{intl.formatMessage(messages.plexwatchlist)}</span>
          <ArrowRightCircleIcon />
        </Link>
      </div>
      <Slider
        sliderKey="watchlist"
        isLoading={!watchlistItems}
        isEmpty={!!tmdbWatchlistItems && tmdbWatchlistItems.length === 0}
        emptyMessage={intl.formatMessage(messages.emptywatchlist, {
          PlexWatchlistSupportLink: (msg: React.ReactNode) => (
            <a
              href="https://support.plex.tv/articles/universal-watchlist/"
              className="text-white transition duration-300 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              {msg}
            </a>
          ),
        })}
        items={tmdbWatchlistItems?.map((item) => (
          <TmdbTitleCard
            id={item.tmdbId}
            key={`watchlist-slider-item-${item.ratingKey}`}
            tmdbId={item.tmdbId}
            type={item.mediaType}
            isAddedToWatchlist={true}
          />
        ))}
      />
    </>
  );
};

export default PlexWatchlistSlider;
