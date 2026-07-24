import SettingsBookLore from '@app/components/Settings/SettingsBookLore';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const BookLoreSettingsPage: NextPage = () => {
  useRouteGuard(Permission.MANAGE_SETTINGS);
  return (
    <SettingsLayout>
      <SettingsBookLore />
    </SettingsLayout>
  );
};

export default BookLoreSettingsPage;
