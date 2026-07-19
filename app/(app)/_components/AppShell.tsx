'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import SyncIndicator from './SyncIndicator';
import Nav, { type NavRole } from './Nav';
import { useOnlineStatus } from '../../../lib/offline/use-sync-status';
import { classifyAppViewport, type AppViewport } from '../../../lib/ui/viewport';

export default function AppShell({
  children,
  role,
  displayName,
  theme,
  compactMode,
}: {
  children: React.ReactNode;
  role: NavRole;
  displayName: string | null;
  theme: 'system' | 'light' | 'dark';
  compactMode: boolean;
}) {
  const online = useOnlineStatus();
  const [viewport, setViewport] = useState<AppViewport | null>(null);

  useEffect(() => {
    const classifyViewport = () => {
      const width = window.visualViewport?.width ?? window.innerWidth;
      const shortestScreenSide = Math.min(window.screen.width, window.screen.height);

      setViewport(classifyAppViewport(width, shortestScreenSide));
    };

    classifyViewport();
    window.addEventListener('resize', classifyViewport);
    window.visualViewport?.addEventListener('resize', classifyViewport);
    return () => {
      window.removeEventListener('resize', classifyViewport);
      window.visualViewport?.removeEventListener('resize', classifyViewport);
    };
  }, []);

  return (
    <div
      className="app-shell"
      data-theme={theme}
      data-density={compactMode ? 'compact' : 'standard'}
      data-viewport={viewport ?? undefined}
    >
      <header className="app-topbar">
        <div className="app-topbar__brand">
          <span className="app-topbar__menu" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <Image className="app-topbar__logo" src="/dtc-logo.jpeg" alt="DTC Direct Trucking Company" width={148} height={48} priority />
          <span className="app-topbar__product">Direct Trucking Company</span>
        </div>
        <div className="app-topbar__status">
          <span className="app-topbar__system"><b>01</b>DTC / E-Lock control system</span>
          <SyncIndicator />
          <span
            className="app-topbar__online"
            data-online={online}
            aria-label={online ? 'Online' : 'Offline'}
          >
            <span aria-hidden="true" />
            {online ? 'Online' : 'Offline'}
          </span>
          <div className="app-topbar__session">
            <strong>{role === 'supervisor' ? 'Supervisor' : role === 'installer' ? 'Installer' : 'Operator'}</strong>
            <span>{displayName ?? 'Field session'}</span>
          </div>
        </div>
      </header>
      <div className="app-shell__body">
        <Nav role={role} />
        <div className="app-shell__content">{children}</div>
      </div>
    </div>
  );
}
