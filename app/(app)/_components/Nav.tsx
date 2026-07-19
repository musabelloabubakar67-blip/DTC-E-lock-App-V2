'use client';

// Bottom nav for one-handed phone use. Role comes from the server (session), passed down as a
// prop — never guessed client-side. Presentation only: no submit/mutation logic lives here.
import Link from 'next/link';
import { AlertTriangle, Boxes, ClipboardCheck, House, ListChecks, PackagePlus, Search, Settings, ShieldCheck, Truck, Wrench } from 'lucide-react';
import { usePathname } from 'next/navigation';

export type NavRole = 'installer' | 'supervisor' | null;

type NavLink = {
  href: string;
  label: string;
  icon: string;
  activeOn?: string[];
  contextOnly?: boolean;
};

const INSTALLER_LINKS: NavLink[] = [
  { href: '/', label: 'Dashboard', icon: 'home' },
  { href: '/register', label: 'Register', icon: 'register' },
  { href: '/install', label: 'Install', icon: 'install' },
  { href: '/fault', label: 'Repairs', icon: 'fault', activeOn: ['/fault', '/triage'] },
  { href: '/lookup', label: 'Lookup', icon: 'lookup' },
  { href: '/movement', label: 'Reassign & Replace', icon: 'movement', contextOnly: true },
];

const SUPERVISOR_ONLY_LINKS: NavLink[] = [
  { href: '/review', label: 'Review', icon: 'review' },
];

const SETTINGS_LINK: NavLink = { href: '/settings', label: 'Settings', icon: 'settings' };

export default function Nav({ role }: { role: NavRole }) {
  const pathname = usePathname();

  const roleLinks = INSTALLER_LINKS.map((link) =>
    role === 'supervisor' && link.label === 'Repairs' ? { ...link, href: '/triage' } : link,
  );
  const links = role === 'supervisor'
    ? [...roleLinks, ...SUPERVISOR_ONLY_LINKS, SETTINGS_LINK]
    : [...roleLinks, SETTINGS_LINK];
  const primaryLinks = links.slice(0, 4);
  const secondaryLinks = links.slice(4);

  const isActive = (link: NavLink) => pathname === link.href || Boolean(link.activeOn?.includes(pathname));

  const renderSecondaryLinks = () => secondaryLinks.map((link) => (
    <Link
      key={link.href}
      className="nav__link"
      href={link.href}
      data-active={isActive(link)}
      data-context-only={link.contextOnly || undefined}
      data-mobile-primary="false"
    >
      <span className="nav__icon" aria-hidden="true">
        <NavIcon name={link.icon} />
      </span>
      {link.label}
    </Link>
  ));

  return (
    <nav className="nav" aria-label="Main navigation">
      {primaryLinks.map((link) => (
        <Link key={link.href} className="nav__link" href={link.href} data-active={isActive(link)} data-mobile-primary="true">
          <span className="nav__icon" aria-hidden="true">
            <NavIcon name={link.icon} />
          </span>
          {link.label}
        </Link>
      ))}
      <div className="nav__more-panel nav__more-panel--desktop">
        {renderSecondaryLinks()}
      </div>
      <details className="nav__more-menu">
        <summary className="nav__more">
          <span className="nav__more-dots" aria-hidden="true"><i /><i /><i /></span>
          More
        </summary>
        <div className="nav__more-panel nav__more-panel--mobile">
          {renderSecondaryLinks()}
        </div>
      </details>
    </nav>
  );
}

function NavIcon({ name }: { name: string }) {
  const icons = { home: House, register: PackagePlus, install: Wrench, fault: AlertTriangle, movement: Truck, lookup: Search, verify: ShieldCheck, triage: ListChecks, review: ClipboardCheck, settings: Settings } as const;
  const Icon = icons[name as keyof typeof icons] ?? Boxes;
  return <Icon strokeWidth={1.9} aria-hidden="true" />;
}
