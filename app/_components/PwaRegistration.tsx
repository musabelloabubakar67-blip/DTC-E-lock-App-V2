'use client';

import { useEffect } from 'react';

const CACHE_PREFIX = 'dtc-elock-';

export default function PwaRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
      if ('caches' in window) {
        void caches.keys().then((keys) =>
          Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key))),
        );
      }
      return;
    }

    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;
    const handleControllerChange = () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    const register = () => {
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((registration) => registration.update())
        .catch((error: unknown) => console.error('Service worker registration failed', error));
    };

    if (document.readyState === 'complete') {
      register();
      return () => navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    }

    window.addEventListener('load', register, { once: true });
    return () => {
      window.removeEventListener('load', register);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return null;
}
