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

    const register = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
