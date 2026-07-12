'use client';

import Image from 'next/image';
import SyncIndicator from './SyncIndicator';
import Nav, { type NavRole } from './Nav';
import { useOnlineStatus } from '../../../lib/offline/use-sync-status';

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

  return (
    <div className="app-shell" data-theme={theme} data-density={compactMode ? 'compact' : 'standard'}>
      <header className="app-topbar">
        <div className="app-topbar__brand">
          <span className="app-topbar__menu" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <Image className="app-topbar__logo" src="/dtc-logo-white-cropped.png" alt="DTC Direct Trucking Company" width={148} height={48} priority />
          <span className="app-topbar__product">E-Lock</span>
        </div>
        <div className="app-topbar__status">
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
