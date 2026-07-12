'use client';

// Bottom nav for one-handed phone use. Role comes from the server (session), passed down as a
// prop — never guessed client-side. Presentation only: no submit/mutation logic lives here.
import Link from 'next/link';
import { AlertTriangle, Boxes, ClipboardCheck, House, ListChecks, PackagePlus, Search, Settings, ShieldCheck, Truck, Wrench } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

export type NavRole = 'installer' | 'supervisor' | null;

const INSTALLER_LINKS = [
  { href: '/', label: 'Dashboard', icon: 'home' },
  { href: '/register', label: 'Register', icon: 'register' },
  { href: '/install', label: 'Install', icon: 'install' },
  { href: '/fault', label: 'Fault', icon: 'fault' },
  { href: '/movement', label: 'Movement', icon: 'movement' },
  { href: '/lookup', label: 'Lookup', icon: 'lookup' },
  { href: '/verify', label: 'Verify', icon: 'verify' },
];

const SUPERVISOR_ONLY_LINKS = [
  { href: '/triage', label: 'Triage', icon: 'triage' },
  { href: '/review', label: 'Review', icon: 'review' },
];

const SETTINGS_LINK = { href: '/settings', label: 'Settings', icon: 'settings' };

export default function Nav({ role }: { role: NavRole }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const links = role === 'supervisor'
    ? [...INSTALLER_LINKS, ...SUPERVISOR_ONLY_LINKS, SETTINGS_LINK]
    : [...INSTALLER_LINKS, SETTINGS_LINK];

  return (
    <nav className="nav" aria-label="Main navigation" data-more-open={moreOpen}>
      {links.map((link, index) => (
        <Link key={link.href} className="nav__link" href={link.href} data-active={pathname === link.href} data-mobile-primary={index < 4} onClick={() => setMoreOpen(false)}>
          <span className="nav__icon" aria-hidden="true">
            <NavIcon name={link.icon} />
          </span>
          {link.label}
        </Link>
      ))}
      <button className="nav__more" type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
        <span className="nav__more-dots" aria-hidden="true"><i /><i /><i /></span>
        More
      </button>
    </nav>
  );
}

function NavIcon({ name }: { name: string }) {
  const icons = { home: House, register: PackagePlus, install: Wrench, fault: AlertTriangle, movement: Truck, lookup: Search, verify: ShieldCheck, triage: ListChecks, review: ClipboardCheck, settings: Settings } as const;
  const Icon = icons[name as keyof typeof icons] ?? Boxes;
  return <Icon strokeWidth={1.9} aria-hidden="true" />;
}
