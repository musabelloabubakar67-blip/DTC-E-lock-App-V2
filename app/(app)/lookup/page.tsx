'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { offlineDb } from '../../../lib/offline/db';
import {
  Badge,
  DataTable,
  IndustrialPageHeader,
  Panel,
  ReviewCard,
  StatusList,
  TrustBanner,
  formatTimestamp,
} from '../_components/ProductUI';
import { changeTruckCompany, fetchLookupCockpit, type LookupCockpitViewModel } from './actions';

type PendingQueueItem = {
  id: string;
  endpoint: string;
  clientTs: number;
  status: 'pending';
};

const RECENT_LOOKUPS_KEY = 'dtc-elock:recent-lookups';

export default function LookupPage() {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<LookupCockpitViewModel | null>(null);
  const [pendingQueue, setPendingQueue] = useState<PendingQueueItem[]>([]);
  const [recentLookups, setRecentLookups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [companyChoice, setCompanyChoice] = useState<'mrs' | 'dangote' | ''>('');
  const [companyResult, setCompanyResult] = useState<{ status: 'idle' | 'saving' | 'ok' | 'error'; message?: string }>({
    status: 'idle',
  });

  useEffect(() => {
    let cancelled = false;

    async function loadQueue() {
      try {
        const rows = await offlineDb.mutations.where('status').equals('pending').sortBy('seq');
        if (!cancelled) {
          setPendingQueue(
            rows.map((row) => ({
              id: row.id,
              endpoint: row.endpoint,
              clientTs: row.clientTs,
              status: 'pending' as const,
            })),
          );
        }
      } catch {
        if (!cancelled) setPendingQueue([]);
      }
    }

    void loadQueue();
    const interval = window.setInterval(loadQueue, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(RECENT_LOOKUPS_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      setRecentLookups(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 4) : []);
    } catch {
      setRecentLookups([]);
    }
  }, []);

  async function loadCockpit(nextQuery: string) {
    setLoading(true);
    setError(null);
    const result = await fetchLookupCockpit(nextQuery);
    if (!result) {
      setError('Lookup data could not be loaded.');
    } else {
      setView(result);
      setCompanyChoice(result.company.value ?? '');
    }
    setLoading(false);
  }

  async function handleReassignCompany() {
    if (!view || view.target.kind !== 'truck' || !view.target.id || !companyChoice) return;
    setCompanyResult({ status: 'saving' });
    const outcome = await changeTruckCompany(view.target.id, companyChoice);
    if (outcome.status === 'ok') {
      setCompanyResult({ status: 'ok' });
      await loadCockpit(query);
    } else {
      setCompanyResult({ status: 'error', message: outcome.message });
    }
  }

  async function handleLookup(event: React.FormEvent) {
    event.preventDefault();
    setHasSearched(true);
    setCompanyResult({ status: 'idle' });
    rememberLookup(query);
    await loadCockpit(query);
  }

  function rememberLookup(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const next = [trimmed, ...recentLookups.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, 4);
    setRecentLookups(next);
    try {
      window.localStorage.setItem(RECENT_LOOKUPS_KEY, JSON.stringify(next));
    } catch {
      // Recent lookups are a convenience only.
    }
  }

  async function runRecentLookup(value: string) {
    setQuery(value);
    setHasSearched(true);
    setCompanyResult({ status: 'idle' });
    rememberLookup(value);
    await loadCockpit(value);
  }

  const syncItems = pendingQueue.length > 0 ? pendingQueue : view?.sync.items ?? [];
  const targetLabel = view?.target.kind === 'unknown' && hasSearched ? 'Unknown target' : view?.target.label ?? 'No lookup target';
  const currentMother = view?.kit.mother;
  const currentSubs = view?.kit.subs ?? [
    { slot: 'B' as const, id: null, serial: null },
    { slot: 'C' as const, id: null, serial: null },
    { slot: 'D' as const, id: null, serial: null },
  ];
  const truckContext = view?.target.kind === 'truck' ? view.target.label : null;
  const deviceContext = view?.target.kind === 'mother_device' ? view.target.label : currentMother?.serial ?? null;

  const statusItems = useMemo(
    () => [
      { label: 'Target', value: targetLabel, tone: view?.target.kind === 'unknown' ? ('muted' as const) : ('ok' as const) },
      {
        label: 'Mother lock',
        value: currentMother?.serial ?? 'Not set',
        tone: currentMother ? ('muted' as const) : ('danger' as const),
      },
      {
        label: 'Sub-locks (B C D)',
        value: currentSubs.every((slot) => slot.serial) ? 'All set' : 'Not set',
        tone: currentSubs.every((slot) => slot.serial) ? ('muted' as const) : ('danger' as const),
      },
      {
        label: 'Kit status',
        value: view?.kit.status === 'confirmed' ? 'CONFIRMED' : 'NOT CONFIRMED',
        tone: view?.kit.status === 'confirmed' ? ('ok' as const) : ('danger' as const),
      },
      {
        label: 'Trust state',
        value: (view?.trust.state ?? 'unverified').toUpperCase(),
        tone: view?.trust.state === 'verified' ? ('ok' as const) : ('danger' as const),
      },
      { label: 'Last verified', value: formatTimestamp(view?.trust.latestVerifiedAt ?? null), tone: 'muted' as const },
      {
        // §2/§6: "not yet declared" is a normal, expected state — never rendered as an error or
        // a blank value.
        label: 'Serving company',
        value: view?.company.declared ? view.company.value!.toUpperCase() : 'Not yet declared',
        tone: view?.company.declared ? ('ok' as const) : ('muted' as const),
      },
    ],
    [currentMother, currentSubs, targetLabel, view],
  );

  return (
    <main className="lookup-cockpit">
      <IndustrialPageHeader
        eyebrow="Unified truck and device dossier"
        title="Lookup"
        accent="Asset"
        metric={view ? '01' : '00'}
        description="One visible identity leads to assignment, registration, ownership and audit history."
        status={loading ? <Badge tone="warning">Loading</Badge> : <Badge tone="muted">{targetLabel}</Badge>}
      />

      {error && <p className="banner banner--error">{error}</p>}

      <TrustBanner
        empty={false}
        state={view?.trust.state ?? 'unverified'}
        latestVerifiedAt={view?.trust.latestVerifiedAt ?? null}
        weakestTier={view?.trust.weakestTier ?? null}
      />

      <div className="cockpit-grid">
        <section className="cockpit-grid__primary">
          <Panel title="Truck Lookup">
            <form className="lookup-search" onSubmit={handleLookup}>
              <label>
                <span>Search target</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Truck plate, mother serial, or device serial"
                />
              </label>
              <button className="btn btn--primary" type="submit">
                Search
              </button>
            </form>
            <div className="recent-strip">
              <span>Recent:</span>
              {recentLookups.length === 0 && <em>No recent lookups</em>}
              {recentLookups.map((item) => (
                <button key={item} type="button" onClick={() => void runRecentLookup(item)}>
                  {item}
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Audit trail (latest)" className="audit-panel">
            <DataTable
              columns={['Time', 'User', 'Action', 'Entity', 'Details']}
              rows={(view?.audit ?? []).map((row) => [
                formatTimestamp(row.createdAt),
                row.actorName ?? '-',
                row.operation,
                row.entityTable,
                row.summary,
              ])}
              emptyLabel="No audit rows available for this organisation yet."
            />
          </Panel>
        </section>

        <section className="cockpit-grid__middle">
          <Panel title="Current kit status">
            <StatusList items={statusItems} />
          </Panel>

          {view && view.target.kind !== 'unknown' && (
            <Panel title="Operational actions">
              <div className="context-action-grid">
                <Link className="btn btn--primary" href={withContext('/verify', { truck: truckContext })}>
                  Verify physical kit
                </Link>
                <Link className="btn btn--secondary" href={withContext('/fault', { truck: truckContext, device: deviceContext })}>
                  Report fault
                </Link>
                <Link className="btn btn--secondary" href={withContext('/movement', { truck: truckContext, device: deviceContext })}>
                  Reassign or replace
                </Link>
              </div>
            </Panel>
          )}

          {view?.target.kind === 'truck' && view.target.id && (
            <Panel title="Serving company — correction (supervisor only)">
              <p className="empty-state">
                Normally set automatically by the next install. Use this only to fix a data-entry
                error or declare ahead of an install actually happening.
              </p>
              <div className="checklist-grid">
                <label>
                  <span>Company</span>
                  <select value={companyChoice} onChange={(event) => setCompanyChoice(event.target.value as 'mrs' | 'dangote' | '')}>
                    <option value="">Select company</option>
                    <option value="mrs">MRS</option>
                    <option value="dangote">Dangote</option>
                  </select>
                </label>
              </div>
              {companyResult.status === 'ok' && <p className="banner banner--ok">Serving company updated.</p>}
              {companyResult.status === 'error' && <p className="banner banner--error">{companyResult.message}</p>}
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => void handleReassignCompany()}
                disabled={!companyChoice || companyResult.status === 'saving'}
              >
                {companyResult.status === 'saving' ? 'Saving' : 'Reassign company'}
              </button>
            </Panel>
          )}

          <Panel title={`Offline sync queue (${syncItems.length})`}>
            <DataTable
              columns={['Time', 'Endpoint', 'Status']}
              rows={syncItems.map((item) => [formatClientTimestamp(item.clientTs), item.endpoint, item.status])}
              emptyLabel="No pending local sync items."
            />
          </Panel>
        </section>

        <section className="cockpit-grid__side">
          <Panel title="Operational archives">
            <div className="context-action-grid">
              <Link className="btn btn--secondary" href="/register?archive=1#registered-kits">
                Registered kits
              </Link>
              <Link className="btn btn--secondary" href="/install?archive=1#installation-history">
                Installation history
              </Link>
            </div>
          </Panel>

          <Panel
            title="Conflict reviews"
            action={view?.reviews?.length ? <Badge tone="danger">{view.reviews.length}</Badge> : null}
          >
            <div className="review-stack">
              {(view?.reviews ?? []).length === 0 && <p className="empty-state">No open conflict reviews.</p>}
              {(view?.reviews ?? []).map((review) => (
                <ReviewCard key={review.id} kind={review.kind} createdAt={review.createdAt} payload={review.payload} />
              ))}
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function withContext(path: string, values: { truck?: string | null; device?: string | null }): string {
  const params = new URLSearchParams();
  if (values.truck) params.set('truck', values.truck);
  if (values.device) params.set('device', values.device);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
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
