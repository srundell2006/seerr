import type { BookDetailsType } from '@app/components/BookDetails';
import BookDetails from '@app/components/BookDetails';
import { getHostAndPort } from '@app/utils/urlHelper';
import axios from 'axios';
import type { GetServerSideProps, NextPage } from 'next';

interface BookPageProps {
  book?: BookDetailsType;
}

const BookPage: NextPage<BookPageProps> = ({ book }) => {
  return <BookDetails book={book} />;
};

export const getServerSideProps: GetServerSideProps<BookPageProps> = async (
  ctx
) => {
  try {
    const response = await axios.get<BookDetailsType>(
      `http://${getHostAndPort()}/api/v1/book/${ctx.query.bookId}`,
      {
        headers: ctx.req?.headers?.cookie
          ? { cookie: ctx.req.headers.cookie }
          : undefined,
      }
    );

    return {
      props: {
        book: response.data,
      },
    };
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) {
      return { notFound: true };
    }

    // Anything else — most often BookLore being unconfigured or unreachable —
    // renders without server data so the client can retry and report the
    // failure itself rather than blowing up into a 500 page.
    return { props: {} };
  }
};

export default BookPage;
