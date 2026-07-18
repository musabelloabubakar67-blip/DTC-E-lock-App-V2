'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { offlineDb } from '../../../lib/offline/db';
import {
  Badge,
  DataTable,
  IndustrialPageHeader,
  Panel,
  StatusList,
  TrustBanner,
} from '../_components/ProductUI';
import { fetchRepairPool, submitTriage, type RepairPoolItem } from './actions';

type TriageOutcome = 'revived' | 'dead';
type TriageState =
  | { status: 'idle' }
  | { status: 'working'; deviceId: string; outcome: TriageOutcome }
  | { status: 'queued'; deviceId: string; outcome: TriageOutcome; mutationId: string }
  | { status: 'error'; message: string };

type PendingTriage = {
  id: string;
  deviceId: string | null;
  outcome: string | null;
  clientTs: number;
  status: 'pending';
};

export default function TriagePage() {
  const [items, setItems] = useState<RepairPoolItem[]>([]);
  const [pendingDeviceIds, setPendingDeviceIds] = useState<Set<string>>(new Set());
  const [pendingTriage, setPendingTriage] = useState<PendingTriage[]>([]);
  const [state, setState] = useState<TriageState>({ status: 'idle' });
  const [loading, setLoading] = useState(true);

  async function reloadRepairPool() {
    setLoading(true);
    try {
      setItems(await fetchRepairPool());
    } catch {
      setItems([]);
      setState({ status: 'error', message: 'Could not load the repair pool' });
    } finally {
      setLoading(false);
    }
  }

  async function reloadPendingTriage() {
    try {
      const rows = await offlineDb.mutations.where('status').equals('pending').sortBy('seq');
      setPendingTriage(
        rows
          .filter((row) => row.endpoint === '/api/triage')
          .map((row) => {
            const payload = row.payload as Partial<{ deviceId: string; outcome: string }> | null;
            return {
              id: row.id,
              deviceId: typeof payload?.deviceId === 'string' ? payload.deviceId : null,
              outcome: typeof payload?.outcome === 'string' ? payload.outcome : null,
              clientTs: row.clientTs,
              status: 'pending' as const,
            };
          }),
      );
    } catch {
      setPendingTriage([]);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (cancelled) return;
      await reloadRepairPool();
      if (!cancelled) await reloadPendingTriage();
    }

    void load();
    const interval = window.setInterval(() => {
      void reloadPendingTriage();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function handleAction(deviceId: string, outcome: TriageOutcome) {
    setState({ status: 'working', deviceId, outcome });
    const result = await submitTriage(deviceId, outcome);
    if (result.status === 'error') {
      setState({ status: 'error', message: result.message });
      return;
    }

    setPendingDeviceIds((current) => new Set(current).add(deviceId));
    setState({ status: 'queued', deviceId, outcome, mutationId: result.mutationId });
    await reloadPendingTriage();
  }

  const visibleItems = items.filter((item) => !pendingDeviceIds.has(item.deviceId));
  const motherItems = visibleItems.filter((item) => item.deviceType === 'mother');
  const subItems = visibleItems.filter((item) => item.deviceType === 'sub');
  const urgentItems = visibleItems.filter((item) => repairAgeDays(item.enteredRepairAt) >= 7);

  const selectedItem = useMemo(() => {
    if (state.status !== 'working' && state.status !== 'queued') return visibleItems[0] ?? null;
    return items.find((item) => item.deviceId === state.deviceId) ?? null;
  }, [items, state, visibleItems]);

  const statusItems = useMemo(
    () => [
      {
        label: 'Repair pool',
        value: loading ? 'Loading' : String(visibleItems.length),
        tone: visibleItems.length > 0 ? ('danger' as const) : ('ok' as const),
      },
      {
        label: 'Mother locks',
        value: String(motherItems.length),
        tone: motherItems.length > 0 ? ('danger' as const) : ('muted' as const),
      },
      {
        label: 'Sub-locks',
        value: String(subItems.length),
        tone: subItems.length > 0 ? ('danger' as const) : ('muted' as const),
      },
      {
        label: 'Aged 7+ days',
        value: String(urgentItems.length),
        tone: urgentItems.length > 0 ? ('danger' as const) : ('muted' as const),
      },
      {
        label: 'Pending sync',
        value: String(pendingTriage.length),
        tone: pendingTriage.length > 0 ? ('danger' as const) : ('ok' as const),
      },
    ],
    [loading, motherItems.length, pendingTriage.length, subItems.length, urgentItems.length, visibleItems.length],
  );

  return (
    <main className="triage-cockpit">
      <IndustrialPageHeader
        eyebrow="Device disposition workbench"
        title="Repairs"
        accent="Queue"
        metric={loading ? '--' : String(visibleItems.length).padStart(2, '0')}
        description="Reported devices move through controlled repair, return-to-service or retirement decisions."
        status={<Badge tone={pendingTriage.length > 0 ? 'warning' : 'muted'}>{pendingTriage.length} repair actions queued</Badge>}
      />

      <nav className="workflow-tabs" aria-label="Repairs views">
        <Link href="/fault">Report fault</Link>
        <Link href="/triage" aria-current="page">Repair queue</Link>
      </nav>

      <TrustBanner
        empty={loading || visibleItems.length === 0}
        emptyTitle={loading ? 'Loading repair pool' : 'Repair pool clear'}
        emptyBody={
          loading
            ? 'Live repair devices are loading from the server.'
            : 'No devices require supervisor triage right now.'
        }
        state="unverified"
        latestVerifiedAt={null}
        weakestTier={null}
      />

      {state.status === 'queued' && (
        <p className="banner banner--ok">
          {`${selectedItem?.serial ?? state.deviceId} saved on device as ${formatOutcome(state.outcome)}. Pending sync.`}
        </p>
      )}
      {state.status === 'error' && (
        <p className="banner banner--error" role="alert">
          {`Error: ${state.message}`}
        </p>
      )}

      <div className="cockpit-grid">
        <section className="cockpit-grid__primary">
          <Panel title={`Repair pool (${visibleItems.length})`}>
            <div className="triage-card-stack">
              {visibleItems.length === 0 && (
                <p className="empty-state">
                  {loading ? 'Loading devices in repair.' : 'Nothing in the repair pool.'}
                </p>
              )}
              {visibleItems.map((item) => (
                <RepairPoolCard
                  key={item.deviceId}
                  item={item}
                  working={
                    state.status === 'working' &&
                    state.deviceId === item.deviceId
                  }
                  onAction={handleAction}
                />
              ))}
            </div>
          </Panel>
        </section>

        <section className="cockpit-grid__middle">
          <Panel title="Triage status">
            <StatusList items={statusItems} />
          </Panel>

          <Panel
            title="Selected device"
            action={selectedItem ? (
              <Link className="btn btn--secondary btn--compact" href={`/movement?device=${encodeURIComponent(selectedItem.serial)}`}>
                Reassign or replace
              </Link>
            ) : null}
          >
            {selectedItem ? (
              <StatusList
                items={[
                  { label: 'Serial', value: selectedItem.serial, tone: 'muted' },
                  { label: 'Type', value: formatType(selectedItem.deviceType), tone: 'muted' },
                  {
                    label: 'Time in repair',
                    value: repairAgeLabel(selectedItem.enteredRepairAt),
                    tone: repairAgeDays(selectedItem.enteredRepairAt) >= 7 ? 'danger' : 'muted',
                  },
                  { label: 'Removal reason', value: formatNullable(selectedItem.removalReason), tone: 'muted' },
                  { label: 'Action rule', value: 'Supervisor only', tone: 'danger' },
                ]}
              />
            ) : (
              <p className="empty-state">Select a device from the repair pool.</p>
            )}
          </Panel>
        </section>

        <section className="cockpit-grid__side">
          <Panel title={`Triage sync queue (${pendingTriage.length})`}>
            <DataTable
              columns={['Time', 'Device', 'Outcome', 'Status']}
              rows={pendingTriage.map((item) => [
                formatClientTimestamp(item.clientTs),
                item.deviceId ?? '-',
                item.outcome ? formatOutcome(item.outcome) : '-',
                item.status,
              ])}
              emptyLabel="No queued triage actions on this device."
            />
          </Panel>

          <Panel title="Disposition rules">
            <StatusList
              items={[
                { label: 'Revive', value: 'repair to available', tone: 'ok' },
                { label: 'Declare dead', value: 'repair to faulty', tone: 'danger' },
                { label: 'Write path', value: 'Local queue first', tone: 'ok' },
                { label: 'Server rule', value: 'Supervisor enforced', tone: 'danger' },
              ]}
            />
          </Panel>
        </section>
      </div>
    </main>
  );
}

function RepairPoolCard({
  item,
  working,
  onAction,
}: {
  item: RepairPoolItem;
  working: boolean;
  onAction: (deviceId: string, outcome: TriageOutcome) => void;
}) {
  const ageDays = repairAgeDays(item.enteredRepairAt);

  return (
    <article className="triage-card">
      <header>
        <div>
          <Badge tone={item.deviceType === 'mother' ? 'danger' : 'warning'}>{formatType(item.deviceType)}</Badge>
          <strong>{item.serial}</strong>
          <span>{item.deviceId}</span>
        </div>
        <Badge tone={ageDays >= 7 ? 'danger' : 'muted'}>{repairAgeLabel(item.enteredRepairAt)}</Badge>
      </header>

      <dl className="payload-grid">
        <PayloadRow label="Removal reason" value={formatNullable(item.removalReason)} />
        <PayloadRow label="Removal notes" value={formatNullable(item.removalNotes)} />
      </dl>

      <div className="list-item__actions">
        <button className="btn btn--primary" type="button" disabled={working} onClick={() => onAction(item.deviceId, 'revived')}>
          Revive
        </button>
        <button className="btn btn--danger" type="button" disabled={working} onClick={() => onAction(item.deviceId, 'dead')}>
          Declare dead
        </button>
      </div>
    </article>
  );
}

function PayloadRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function repairAgeDays(unixSeconds: number | null): number {
  if (!unixSeconds) return 0;
  return Math.max(0, Math.floor((Date.now() / 1000 - unixSeconds) / 86400));
}

function repairAgeLabel(unixSeconds: number | null): string {
  if (!unixSeconds) return 'Entry unknown';
  const days = repairAgeDays(unixSeconds);
  if (days === 0) return 'Entered today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function formatClientTimestamp(value: number): string {
  if (!value) return '-';
  const date = value > 100000000000 ? new Date(value) : new Date(value * 1000);
  return new Intl.DateTimeFormat("en-GB", {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatOutcome(value: string): string {
  return value === 'dead' ? 'declare dead' : value.replaceAll('_', ' ');
}

function formatType(value: string): string {
  return value === 'mother' ? 'Mother lock' : 'Sub-lock';
}

function formatNullable(value: string | null): string {
  return value ? value.replaceAll('_', ' ') : 'Not recorded';
}
