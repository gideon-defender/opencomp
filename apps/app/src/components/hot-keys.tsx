'use client';

import { useRouter } from 'next/navigation';
import { useHotkeys } from 'react-hotkeys-hook';

export function HotKeys() {
  const router = useRouter();

  useHotkeys('ctrl+m', (evt) => {
    evt.preventDefault();
    router.push('/settings/users');
  });

  useHotkeys('meta+m', (evt) => {
    evt.preventDefault();
    router.push('/settings/users');
  });

  useHotkeys('ctrl+e', (evt) => {
    evt.preventDefault();
    router.push('/account/teams');
  });

  useHotkeys('ctrl+a', (evt) => {
    evt.preventDefault();
    router.push('/apps');
  });

  useHotkeys('ctrl+meta+p', (evt) => {
    evt.preventDefault();
    router.push('/account');
  });

  useHotkeys('shift+meta+p', (evt) => {
    evt.preventDefault();
    router.push('/account');
  });

  return null;
}
