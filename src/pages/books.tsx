import BookSearch from '@app/components/BookSearch';
import LibraryList from '@app/components/BookSearch/LibraryList';
import WantedList from '@app/components/BookSearch/WantedList';
import Header from '@app/components/Common/Header';
import PageTitle from '@app/components/Common/PageTitle';
import defineMessages from '@app/utils/defineMessages';
import type { NextPage } from 'next';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('pages.books', {
  books: 'Books',
  search: 'Search',
  library: 'Library',
  wanted: 'Wanted',
});

type BookTab = 'search' | 'library' | 'wanted';

const BooksPage: NextPage = () => {
  const intl = useIntl();
  const [currentTab, setCurrentTab] = useState<BookTab>('search');

  const tabs: { key: BookTab; label: string }[] = [
    { key: 'search', label: intl.formatMessage(messages.search) },
    { key: 'library', label: intl.formatMessage(messages.library) },
    { key: 'wanted', label: intl.formatMessage(messages.wanted) },
  ];

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.books)} />
      <Header>{intl.formatMessage(messages.books)}</Header>

      <div className="mt-6">
        <div className="sm:hidden">
          <label htmlFor="book-tabs" className="sr-only">
            {intl.formatMessage(messages.books)}
          </label>
          <select
            id="book-tabs"
            value={currentTab}
            onChange={(e) => setCurrentTab(e.target.value as BookTab)}
            aria-label="Selected Tab"
          >
            {tabs.map((tab) => (
              <option key={`book-tab-mobile-${tab.key}`} value={tab.key}>
                {tab.label}
              </option>
            ))}
          </select>
        </div>
        <div className="hide-scrollbar hidden overflow-x-scroll border-b border-gray-600 sm:block">
          <nav className="flex" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={`book-tab-${tab.key}`}
                type="button"
                onClick={() => setCurrentTab(tab.key)}
                aria-current={currentTab === tab.key ? 'page' : undefined}
                className={`ml-8 whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium leading-5 transition duration-300 first:ml-0 ${
                  currentTab === tab.key
                    ? 'border-indigo-600 text-indigo-500'
                    : 'border-transparent text-gray-500 hover:border-gray-400 hover:text-gray-300 focus:border-gray-400 focus:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/*
        Every section stays mounted so that a search result set — which can cost
        the better part of a minute to fetch — survives a trip to another tab.
      */}
      <div className={`mt-6 ${currentTab === 'search' ? '' : 'hidden'}`}>
        <BookSearch />
      </div>
      <div className={`mt-6 ${currentTab === 'library' ? '' : 'hidden'}`}>
        <LibraryList />
      </div>
      <div className={currentTab === 'wanted' ? '' : 'hidden'}>
        <WantedList />
      </div>
    </>
  );
};

export default BooksPage;
