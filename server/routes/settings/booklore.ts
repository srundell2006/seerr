import BookLoreAPI from '@server/api/booklore';
import type { BookLoreSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const bookloreRoutes = Router();

// The whole /settings tree is already gated by Permission.ADMIN in
// server/routes/index.ts, so no extra middleware is needed here.

bookloreRoutes.get('/', (_req, res) => {
  const settings = getSettings();
  res.status(200).json(settings.booklore);
});

bookloreRoutes.post<never, BookLoreSettings, BookLoreSettings>(
  '/',
  async (req, res, next) => {
    const settings = getSettings();

    settings.booklore = req.body;
    await settings.save();

    // Verify after saving rather than before, so a user can always store a
    // disabled/incomplete config without the API refusing to persist it.
    if (settings.booklore.enabled) {
      const booklore = new BookLoreAPI({
        url: BookLoreAPI.buildUrl(settings.booklore),
        username: settings.booklore.username,
        password: settings.booklore.password,
      });

      if (!(await booklore.testConnection())) {
        return next({
          status: 500,
          message:
            'Settings saved, but the BookLore connection failed. Check the hostname, credentials, and that the account is a BookLore admin.',
        });
      }
    }

    return res.status(200).json(settings.booklore);
  }
);

bookloreRoutes.post<
  never,
  { connected: boolean; wantedCount: number; isAdmin: boolean },
  BookLoreSettings
>('/test', async (req, res, next) => {
  try {
    const booklore = new BookLoreAPI({
      url: BookLoreAPI.buildUrl(req.body),
      username: req.body.username,
      password: req.body.password,
    });

    // Deliberately not testConnection(): that swallows the error, and the
    // caller wants to know *why* it failed. Hitting the wanted list directly
    // also proves the account is an admin, since every wanted-books endpoint
    // is admin-only — a non-admin logs in fine and then 403s.
    const wanted = await booklore.getWantedBooks();

    return res
      .status(200)
      .json({ connected: true, wantedCount: wanted.length, isAdmin: true });
  } catch (e) {
    const status = e?.response?.status;

    logger.error('Failed to test BookLore', {
      label: 'BookLore',
      errorMessage: e instanceof Error ? e.message : String(e),
      status,
    });

    return next({
      status: 500,
      message:
        status === 403
          ? 'Connected, but that account is not a BookLore admin. Every wanted-books endpoint requires admin.'
          : status === 401
            ? 'BookLore rejected those credentials.'
            : 'Failed to connect to BookLore.',
    });
  }
});

export default bookloreRoutes;
