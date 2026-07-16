import Link from 'next/link';
import {
  AlertTriangle,
  ClipboardCheck,
  ClipboardList,
  ListChecks,
  LockKeyhole,
  Package,
  PackagePlus,
  Search,
  ShieldCheck,
  Truck,
  Wrench,
} from 'lucide-react';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/auth';
import { db } from '../../db';
import { getDashboard } from '../../services/dashboard.service';

const INSTALLER_ACTIONS = [
  { href: '/lookup', label: 'Lookup', icon: 'lookup' },
  { href: '/verify', label: 'Verify', icon: 'verify' },
  { href: '/register', label: 'Register', icon: 'register' },
  { href: '/install', label: 'Install', icon: 'install' },
  { href: '/fault', label: 'Fault', icon: 'fault' },
  { href: '/movement', label: 'Movement', icon: 'movement' },
];

const SUPERVISOR_ACTIONS = [
  { href: '/review', label: 'Review', icon: 'review' },
  { href: '/triage', label: 'Triage', icon: 'triage' },
];

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  const role = user?.role ?? 'installer';
  const dashboard = getDashboard(db, { orgId: user?.orgId ?? '', role });
  const actions = role === 'supervisor' ? [...INSTALLER_ACTIONS, ...SUPERVISOR_ACTIONS] : INSTALLER_ACTIONS;
  const needsAttention = dashboard.counts.openReviews > 0;
  const needsVerification = dashboard.trust.stale + dashboard.trust.unverified;
  const totalAssets = dashboard.counts.registeredKits;
  const utilization = totalAssets ? Math.round((dashboard.counts.inServiceMothers / totalAssets) * 100) : 0;

  const metrics = [
    { label: 'Open reviews', value: dashboard.counts.openReviews, icon: 'review', tone: needsAttention ? 'danger' : 'blue' },
    { label: 'Repair pool', value: dashboard.counts.pendingRepair, icon: 'repair', tone: dashboard.counts.pendingRepair ? 'warning' : 'blue' },
    { label: 'Registered kits', value: dashboard.counts.registeredKits, icon: 'kit', tone: 'blue' },
    { label: 'In service', value: dashboard.counts.inServiceMothers, icon: 'service', tone: 'ok' },
    { label: 'Available mothers', value: dashboard.counts.availableMothers, icon: 'available', tone: 'blue' },
  ] as const;

  return (
    <main className="dd">
      <header className="dd__heading">
        <div>
          <h1>Dashboard</h1>
          <span>{role === 'supervisor' ? 'Supervisor operations cockpit' : 'Field operations cockpit'}</span>
        </div>
        <span className="dd__attention-pill" data-active={needsAttention}>{needsAttention ? 'Needs attention' : 'All clear'}</span>
      </header>

      <section className="dd-alert" data-active={needsAttention}>
        <UiIcon name={needsAttention ? 'fault' : 'verify'} />
        <div>
          <strong>{needsAttention ? `${dashboard.counts.openReviews} reviews need attention` : 'Operations are clear'}</strong>
          <span>{needsAttention ? 'Items are waiting for your review and decision.' : 'No critical review items are currently open.'}</span>
        </div>
        <Link href={needsAttention ? '/review' : '/lookup'}>{needsAttention ? 'Open review' : 'Run lookup'}<b>&gt;</b></Link>
      </section>

      <section className="dd-metrics" aria-label="Operational summary">
        {metrics.map((metric) => (
          <article className="dd-metric" data-tone={metric.tone} key={metric.label}>
            <UiIcon name={metric.icon} />
            <div>
              <span>{metric.label}</span>
              <strong>{metric.value.toLocaleString()}</strong>
              <small>{metric.value > 0 ? 'Live operational count' : 'No current items'}</small>
            </div>
          </article>
        ))}
      </section>

      <section className="dd-panel dd-quick">
        <PanelTitle title="Quick operations" />
        <div className="dd-quick__grid">
          {actions.map((action) => (
            <Link href={action.href} key={action.href}>
              <UiIcon name={action.icon} />
              <span>{action.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="dd-columns">
        <div className="dd-column">
          <section className="dd-panel">
            <PanelTitle title="Trust posture" />
            <div className="dd-trust" data-tone={needsVerification ? 'warning' : 'ok'}>
              <UiIcon name={needsVerification ? 'fault' : 'verify'} />
              <div><strong>{needsVerification ? 'Needs verification' : 'Good'}</strong><span>{needsVerification ? `${needsVerification} assets need attention` : 'No critical issues'}</span></div>
            </div>
            <ValueRow label="Recent verifications" value={dashboard.trust.verified} tone="ok" />
            <ValueRow label="Stale" value={dashboard.trust.stale} tone="warning" />
            <ValueRow label="Unverified" value={dashboard.trust.unverified} tone="danger" />
            <ValueRow label="Active trucks" value={dashboard.trust.total} />
            <PanelFooter href="/lookup" label="View trust details" />
          </section>

          <section className="dd-panel">
            <PanelTitle title="Fleet state" icon="movement" />
            <ValueRow label="Registered kits" value={totalAssets} />
            <ValueRow label="In-service kits" value={dashboard.counts.inServiceMothers} tone="ok" />
            <ValueRow label="Available mothers" value={dashboard.counts.availableMothers} />
            <ValueRow label="Faulty devices" value={dashboard.counts.faultyDevices} tone="warning" />
            <ValueRow label="Utilization" value={`${utilization}%`} tone="ok" />
            <PanelFooter href="/lookup" label="View fleet state" />
          </section>
        </div>

        <div className="dd-column">
          <section className="dd-panel">
            <PanelTitle title="Recent registrations" href="/register" />
            <div className="dd-feed">
              {dashboard.registrations.length === 0 && <Empty label="No registered kits found yet." />}
              {dashboard.registrations.slice(0, 5).map((row) => (
                <div className="dd-feed__row" key={`${row.motherSerial}-${row.loggedDate}`}>
                  <UiIcon name="kit" />
                  <div><strong>{row.motherSerial}</strong><span>{row.subSerials.length ? `Sub-locks: ${row.subSerials.join(' / ')}` : 'No sub-locks recorded'}</span></div>
                  <small>{formatDashboardTimestamp(row.loggedDate)}<br />{row.actorName ?? row.source}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="dd-panel">
            <PanelTitle title="Audit activity" href="/lookup" />
            <div className="dd-feed">
              {dashboard.audit.length === 0 && <Empty label="No audit activity yet." />}
              {dashboard.audit.slice(0, 5).map((row) => (
                <div className="dd-feed__row" key={row.id}>
                  <UiIcon name="verify" />
                  <div><strong>{row.summary}</strong><span>{row.entityTable}</span></div>
                  <small>{formatDashboardTimestamp(row.createdAt)}<br />{row.actorName ?? '-'}</small>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="dd-column">
          <section className="dd-panel">
            <PanelTitle title="Attention queue" href="/review" />
            <div className="dd-feed">
              {dashboard.reviews.length === 0 && <Empty label="No open conflict reviews." />}
              {dashboard.reviews.slice(0, 4).map((review) => (
                <div className="dd-feed__row dd-feed__row--alert" key={review.id}>
                  <UiIcon name="fault" />
                  <div><strong>Review: {review.kind.replaceAll('_', ' ')}</strong><span>Decision required</span></div>
                  <small>{formatDashboardTimestamp(review.createdAt)}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="dd-panel">
            <PanelTitle title="Repair triage" href="/triage" />
            <div className="dd-feed">
              {dashboard.repairPool.length === 0 && <Empty label="No devices are waiting in repair." />}
              {dashboard.repairPool.slice(0, 5).map((device) => (
                <div className="dd-feed__row" key={device.deviceId}>
                  <div><strong>{device.serial}</strong><span>{device.removalReason ?? device.deviceType}</span></div>
                  <small><i className="dd-status-dot" /> Repair</small>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function PanelTitle({ title, href, icon }: { title: string; href?: string; icon?: string }) {
  return <header className="dd-panel__title"><h2>{title}</h2>{href ? <Link href={href}>View all</Link> : icon ? <UiIcon name={icon} /> : null}</header>;
}

function PanelFooter({ href, label }: { href: string; label: string }) {
  return <Link className="dd-panel__footer" href={href}>{label}<span>&gt;</span></Link>;
}

function ValueRow({ label, value, tone = 'muted' }: { label: string; value: React.ReactNode; tone?: 'muted' | 'ok' | 'warning' | 'danger' }) {
  return <div className="dd-value"><span>{label}</span><strong data-tone={tone}>{value}</strong></div>;
}

function Empty({ label }: { label: string }) {
  return <p className="dd-empty">{label}</p>;
}

function formatDashboardTimestamp(unixSeconds: number | null): string {
  if (!unixSeconds) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(unixSeconds * 1000));
}

function UiIcon({ name }: { name: string }) {
  const icons = {
    lookup: Search,
    verify: ShieldCheck,
    register: PackagePlus,
    install: Wrench,
    fault: AlertTriangle,
    movement: Truck,
    review: ClipboardCheck,
    triage: ListChecks,
    repair: Wrench,
    kit: Package,
    service: ShieldCheck,
    available: LockKeyhole,
  } as const;
  const Icon = icons[name as keyof typeof icons] ?? ClipboardList;
  return <Icon className="dd-icon" strokeWidth={2} aria-hidden="true" />;
}
