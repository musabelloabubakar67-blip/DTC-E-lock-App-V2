'use client';

import { useEffect, useMemo, useState } from 'react';
import { offlineDb } from '../../../lib/offline/db';
import type { InstallKitFormValues } from '../../../lib/validations/installation';
import {
  Badge,
  DataTable,
  IndustrialPageHeader,
  Panel,
  ScanInputRow,
  StatusList,
  TrustBanner,
  formatTimestamp,
} from '../_components/ProductUI';
import { submitInstallation, type SubmitInstallationResult } from './actions';

type Checklist = NonNullable<InstallKitFormValues['checklist']>;

type PendingInstall = {
  id: string;
  truckId: string | null;
  truckLabel: string | null;
  motherDeviceId: string | null;
  clientTs: number;
  status: 'pending';
};

type InstallationHistoryItem = {
  id: string;
  loggedDate: number;
  truckId: string;
  truckLabel: string;
  motherSerial: string;
  subSerials: string[];
  overallStatus: 'successful' | 'completed_with_issues' | 'failed' | null;
  actorName: string | null;
};

type CurrentTruckKit = {
  truckId: string;
  truckLabel: string;
  mother: { id: string; serial: string };
  subs: Array<{ slot: 'B' | 'C' | 'D'; id: string; serial: string }>;
};

type LookupCockpitResponse = {
  data?: {
    target: { kind: 'truck' | 'mother_device' | 'unknown'; id: string | null; label: string };
    company: { value: 'mrs' | 'dangote' | null; declared: boolean };
    kit: {
      mother: { id: string; serial: string } | null;
      subs: Array<{ slot: 'B' | 'C' | 'D'; id: string | null; serial: string | null }>;
    };
  };
};

const emptyForm: InstallKitFormValues = {
  installMode: 'changed',
  truckId: '',
  motherDeviceId: '',
  subDeviceIds: ['', '', ''],
  // §6: always required, pre-filled from the truck's current declaration once loaded, blank
  // otherwise — cast is safe because kitComplete/checklistComplete gate submit, not this field.
  company: '' as unknown as InstallKitFormValues['company'],
};

const subSlots = ['B', 'C', 'D'] as const;
const historyPageSize = 5;

export default function InstallPage() {
  const [form, setForm] = useState<InstallKitFormValues>(emptyForm);
  const [result, setResult] = useState<SubmitInstallationResult | { status: 'idle' }>({ status: 'idle' });
  const [pendingInstalls, setPendingInstalls] = useState<PendingInstall[]>([]);
  const [installHistory, setInstallHistory] = useState<InstallationHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [currentKit, setCurrentKit] = useState<CurrentTruckKit | null>(null);
  const [truckQuery, setTruckQuery] = useState('');
  const [loadedTruckLabel, setLoadedTruckLabel] = useState<string | null>(null);
  const [truckLookupState, setTruckLookupState] = useState<'idle' | 'loading' | 'loaded' | 'empty' | 'error'>('idle');
  const [showHistoryArchive, setShowHistoryArchive] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('archive') === '1') {
      setShowHistoryArchive(true);
    }
  }, []);

  useEffect(() => {
    if (!showHistoryArchive) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => void loadInstallHistory(historyPage, historyQuery, controller.signal),
      historyQuery.trim() ? 250 : 0,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [historyPage, historyQuery, showHistoryArchive]);

  useEffect(() => {
    let cancelled = false;

    async function loadPendingInstalls() {
      try {
        const rows = await offlineDb.mutations.where('status').equals('pending').sortBy('seq');
        if (cancelled) return;
        setPendingInstalls(
          rows
            .filter((row) => row.endpoint === '/api/installations')
            .map((row) => {
              const payload = row.payload as Partial<InstallKitFormValues> | null;
              return {
                id: row.id,
                truckId: typeof payload?.truckId === 'string' ? payload.truckId : null,
                truckLabel: typeof (payload as { truckLabel?: unknown } | null)?.truckLabel === 'string' ? (payload as { truckLabel: string }).truckLabel : null,
                motherDeviceId: typeof payload?.motherDeviceId === 'string' ? payload.motherDeviceId : null,
                clientTs: row.clientTs,
                status: 'pending' as const,
              };
            }),
        );
      } catch {
        if (!cancelled) setPendingInstalls([]);
      }
    }

    void loadPendingInstalls();
    const interval = window.setInterval(loadPendingInstalls, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [result]);

  async function loadInstallHistory(page = historyPage, query = historyQuery, signal?: AbortSignal) {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(historyPageSize),
      });
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`/api/installations?${params}`, { cache: 'no-store', signal });
      if (!response.ok) throw new Error('history_failed');
      const payload = (await response.json()) as {
        data?: InstallationHistoryItem[];
        pagination?: { total: number; page: number; pageSize: number };
      };
      setInstallHistory(Array.isArray(payload.data) ? payload.data : []);
      setHistoryTotal(payload.pagination?.total ?? 0);
      if (payload.pagination && payload.pagination.page !== page) setHistoryPage(payload.pagination.page);
      setHistoryError(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setInstallHistory([]);
      setHistoryTotal(0);
      setHistoryError('Installation history could not be loaded.');
    } finally {
      if (!signal?.aborted) setHistoryLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setResult({ status: 'idle' });

    if (!kitComplete || !checklistComplete) {
      setResult({ status: 'error', message: 'Complete kit assignment and config re-check before queueing install.' });
      return;
    }

    const outcome = await submitInstallation({ ...form, truckLabel: truckDisplayLabel } as InstallKitFormValues & { truckLabel: string });
    setResult(outcome);
    if (outcome.status === 'queued') {
      setForm(emptyForm);
      setCurrentKit(null);
      setTruckQuery('');
      setLoadedTruckLabel(null);
      setTruckLookupState('idle');
    }
  }

  async function loadCurrentTruckKit() {
    const query = truckQuery.trim();
    if (!query) {
      setResult({ status: 'error', message: 'Enter a truck first.' });
      return;
    }

    setTruckLookupState('loading');
    setResult({ status: 'idle' });

    try {
      const response = await fetch(`/api/lookup-cockpit?query=${encodeURIComponent(query)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('lookup_failed');

      const payload = (await response.json()) as LookupCockpitResponse;
      const view = payload.data;
      if (!view || view.target.kind !== 'truck' || !view.target.id) {
        setCurrentKit(null);
        setLoadedTruckLabel(null);
        setTruckLookupState('error');
        setResult({ status: 'error', message: 'Truck was not found. Create or confirm the truck record before install.' });
        return;
      }
      const truckId = view.target.id;
      const truckLabel = view.target.label;
      setLoadedTruckLabel(truckLabel);
      setTruckQuery(truckLabel);

      const orderedSubs = subSlots
        .map((slot) => view.kit.subs.find((sub) => sub.slot === slot))
        .filter((sub): sub is { slot: 'B' | 'C' | 'D'; id: string; serial: string } => Boolean(sub?.id && sub.serial));

      // §6: pre-fill with the truck's current declaration if one exists, blank otherwise — the
      // tech confirms (leaves) it or changes it. Applied regardless of same-kit/changed-kit path.
      const currentCompany = view.company.declared ? view.company.value : null;

      if (view.kit.mother && orderedSubs.length === 3) {
        const nextKit: CurrentTruckKit = {
          truckId,
          truckLabel,
          mother: view.kit.mother,
          subs: orderedSubs,
        };
        setCurrentKit(nextKit);
        setTruckLookupState('loaded');
        setForm((current) => ({
          ...current,
          installMode: 'same_kit',
          truckId: nextKit.truckId,
          motherDeviceId: nextKit.mother.id,
          subDeviceIds: orderedSubs.map((sub) => sub.id) as [string, string, string],
          company: (currentCompany ?? '') as InstallKitFormValues['company'],
        }));
        return;
      }

      setCurrentKit(null);
      setTruckLookupState('empty');
      setForm((current) => ({
        ...current,
        installMode: 'changed',
        truckId,
        motherDeviceId: '',
        subDeviceIds: ['', '', ''],
        company: (currentCompany ?? '') as InstallKitFormValues['company'],
      }));
    } catch {
      setCurrentKit(null);
      setLoadedTruckLabel(null);
      setTruckLookupState('error');
      setResult({ status: 'error', message: 'Could not load the truck assignment. Try again or scan the changed kit.' });
    }
  }

  function updateSubDevice(slotIndex: number, value: string) {
    const next = [...form.subDeviceIds] as [string, string, string];
    next[slotIndex] = value;
    setForm({ ...form, subDeviceIds: next });
  }

  function useCurrentKit() {
    if (!currentKit) return;
    setForm({
      ...form,
      installMode: 'same_kit',
      truckId: currentKit.truckId,
      motherDeviceId: currentKit.mother.id,
      subDeviceIds: currentKit.subs.map((sub) => sub.id) as [string, string, string],
    });
  }

  function useChangedKit() {
    setForm({ ...form, installMode: 'changed', motherDeviceId: '', subDeviceIds: ['', '', ''] });
  }

  function updateChecklist<K extends keyof Checklist>(key: K, value: Checklist[K] | '') {
    const next: Checklist = { ...(form.checklist ?? {}) };
    if (value === '') {
      delete next[key];
    } else {
      next[key] = value as Checklist[K];
    }
    setForm({ ...form, checklist: Object.keys(next).length > 0 ? next : undefined });
  }

  const sameKitMode = form.installMode === 'same_kit' && Boolean(currentKit);
  const kitComplete = Boolean(form.truckId && form.motherDeviceId && form.subDeviceIds.every(Boolean) && form.company);
  const checklistComplete = Boolean(
    form.checklist?.configConfirmed &&
      form.checklist?.deviceResponsive &&
      form.checklist?.sublocksResponsive &&
      form.checklist?.overallStatus,
  );
  const truckDisplayLabel = displayTruckLabel(currentKit?.truckLabel, loadedTruckLabel, truckQuery, form.truckId);
  const motherDisplayLabel =
    displayDeviceLabel(currentKit?.mother.serial, form.motherDeviceId) || (form.motherDeviceId ? 'Mother selected' : 'Not set');
  const subLocksDisplayLabel = displaySubLockLabel(currentKit, form.subDeviceIds);
  const statusItems = useMemo(
    () => [
      { label: 'Truck', value: truckDisplayLabel || 'Not set', tone: form.truckId ? ('muted' as const) : ('danger' as const) },
      {
        label: 'Mother lock',
        value: motherDisplayLabel,
        tone: form.motherDeviceId ? ('muted' as const) : ('danger' as const),
      },
      {
        label: 'Sub-locks (B C D)',
        value: subLocksDisplayLabel,
        tone: form.subDeviceIds.every(Boolean) ? ('muted' as const) : ('danger' as const),
      },
      {
        label: 'Serving company',
        value: form.company || 'Not set',
        tone: form.company ? ('muted' as const) : ('danger' as const),
      },
      {
        label: 'Checklist',
        value: checklistComplete ? 'READY' : 'INCOMPLETE',
        tone: checklistComplete ? ('ok' as const) : ('danger' as const),
      },
      {
        label: 'Install mode',
        value: sameKitMode ? 'SAME KIT EVENT' : 'KIT CHANGED / UNKNOWN',
        tone: sameKitMode ? ('ok' as const) : ('muted' as const),
      },
      {
        label: 'Submit state',
        value: result.status === 'queued' ? 'QUEUED' : result.status === 'error' ? 'ERROR' : 'DRAFT',
        tone: result.status === 'queued' ? ('ok' as const) : result.status === 'error' ? ('danger' as const) : ('muted' as const),
      },
    ],
    [checklistComplete, form, motherDisplayLabel, result.status, sameKitMode, subLocksDisplayLabel, truckDisplayLabel],
  );

  return (
    <main className="install-cockpit">
      <IndustrialPageHeader
        eyebrow="Truck and kit assignment"
        title="Install"
        accent="Truck"
        metric={String(pendingInstalls.length).padStart(2, '0')}
        description="Record the current truck assignment and configuration check without mixing it with archive history."
        status={<Badge tone={pendingInstalls.length > 0 ? 'warning' : 'muted'}>{pendingInstalls.length} install events queued</Badge>}
      />

      <TrustBanner
        empty={!kitComplete}
        emptyTitle="Installation draft incomplete"
        emptyBody="Load the truck first. Use the existing kit when unchanged, or scan only when the kit changed."
        state={kitComplete ? 'unverified' : 'unverified'}
        latestVerifiedAt={null}
        weakestTier={null}
      />

      {result.status === 'queued' && <p className="banner banner--ok">Saved on device. Installation is pending sync.</p>}
      {result.status === 'error' && <p className="banner banner--error">{`Error: ${result.message}`}</p>}

      <form className="install-form cockpit-grid" onSubmit={handleSubmit}>
        <section className="cockpit-grid__primary">
          <Panel title="Truck assignment">
            <label>
              <span>Truck</span>
              <input
                value={truckQuery}
                onChange={(event) => {
                  setTruckQuery(event.target.value);
                  setLoadedTruckLabel(null);
                  setForm({
                    ...form,
                    truckId: '',
                    installMode: 'changed',
                    company: '' as InstallKitFormValues['company'],
                  });
                  setCurrentKit(null);
                  setTruckLookupState('idle');
                }}
                placeholder="Enter truck plate"
                required
              />
            </label>
            <button type="button" className="btn btn--primary" onClick={loadCurrentTruckKit} disabled={truckLookupState === 'loading'}>
              {truckLookupState === 'loading' ? 'Loading truck' : 'Load truck kit'}
            </button>
            {truckLookupState === 'loaded' && <p className="empty-state">Current kit loaded. Confirm same kit or mark kit changed.</p>}
            {truckLookupState === 'empty' && <p className="empty-state">No current kit assignment found. Scan the kit for this install.</p>}
            <label>
              {/* §6: ALWAYS shown, ALWAYS required — pre-filled by loadCurrentTruckKit when a
                  declaration exists, blank otherwise. The tech confirms (leaves) or changes it. */}
              <span>Serving company</span>
              <select
                value={form.company}
                onChange={(event) => setForm({ ...form, company: event.target.value as InstallKitFormValues['company'] })}
                required
              >
                <option value="">Select company</option>
                <option value="mrs">MRS</option>
                <option value="dangote">Dangote</option>
              </select>
            </label>
          </Panel>

          <Panel title="Kit installation" className="kit-panel">
            {currentKit && (
              <div className="install-mode-switch" role="group" aria-label="Kit install mode">
                <button type="button" className="btn btn--secondary" aria-pressed={sameKitMode} onClick={useCurrentKit}>
                  Same kit
                </button>
                <button type="button" className="btn btn--secondary" aria-pressed={form.installMode === 'changed'} onClick={useChangedKit}>
                  Kit changed
                </button>
              </div>
            )}

            {sameKitMode && currentKit ? (
              <StatusList
                items={[
                  { label: 'Truck', value: displayTruckLabel(currentKit.truckLabel, form.truckId) || 'Loaded truck', tone: 'ok' },
                  { label: 'Mother lock', value: currentKit.mother.serial, tone: 'ok' },
                  { label: 'Sub-lock B', value: currentKit.subs[0]?.serial ?? '-', tone: currentKit.subs[0] ? 'ok' : 'danger' },
                  { label: 'Sub-lock C', value: currentKit.subs[1]?.serial ?? '-', tone: currentKit.subs[1] ? 'ok' : 'danger' },
                  { label: 'Sub-lock D', value: currentKit.subs[2]?.serial ?? '-', tone: currentKit.subs[2] ? 'ok' : 'danger' },
                ]}
              />
            ) : (
              <>
                <ScanInputRow
                  label="Mother lock"
                  prefix="M"
                  value={form.motherDeviceId}
                  placeholder="Scan or enter mother device ID"
                  onChange={(value) => setForm({ ...form, installMode: 'changed', motherDeviceId: value })}
                />
                {subSlots.map((slot, index) => (
                  <ScanInputRow
                    key={slot}
                    label={`Sub-lock ${slot}`}
                    prefix={slot}
                    value={form.subDeviceIds[index]}
                    placeholder={`Scan or enter sub-lock ${slot} device ID`}
                    onChange={(value) => {
                      setForm((current) => {
                        const next = [...current.subDeviceIds] as [string, string, string];
                        next[index] = value;
                        return { ...current, installMode: 'changed', subDeviceIds: next };
                      });
                    }}
                  />
                ))}
              </>
            )}
          </Panel>
        </section>

        <section className="cockpit-grid__middle">
          <Panel title="Current assignment status">
            <StatusList items={statusItems} />
          </Panel>

          <Panel title="Config re-check">
            <div className="checklist-grid">
              <label>
                <span>Device responsive</span>
                <select
                  value={form.checklist?.deviceResponsive ?? ''}
                  onChange={(event) => updateChecklist('deviceResponsive', event.target.value as Checklist['deviceResponsive'] | '')}
                >
                  <option value="">Not checked</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label>
                <span>Sub-locks responsive</span>
                <select
                  value={form.checklist?.sublocksResponsive ?? ''}
                  onChange={(event) => updateChecklist('sublocksResponsive', event.target.value as Checklist['sublocksResponsive'] | '')}
                >
                  <option value="">Not checked</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label>
                <span>Config confirmed</span>
                <select
                  value={form.checklist?.configConfirmed ?? ''}
                  onChange={(event) => updateChecklist('configConfirmed', event.target.value as Checklist['configConfirmed'] | '')}
                >
                  <option value="">Not checked</option>
                  <option value="yes">Yes</option>
                  <option value="changed">Changed</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label>
                <span>Overall status</span>
                <select
                  value={form.checklist?.overallStatus ?? ''}
                  onChange={(event) => updateChecklist('overallStatus', event.target.value as Checklist['overallStatus'] | '')}
                >
                  <option value="">Not checked</option>
                  <option value="successful">Successful</option>
                  <option value="completed_with_issues">Completed with issues</option>
                  <option value="failed">Failed</option>
                </select>
              </label>
            </div>
            <label>
              <span>Config notes</span>
              <textarea
                value={form.checklist?.configNotes ?? ''}
                onChange={(event) => updateChecklist('configNotes', event.target.value)}
                placeholder="Notes from installation point"
              />
            </label>
            <div className="kit-panel__footer install-submit-bar">
              <Badge tone={kitComplete ? 'ok' : 'danger'}>{sameKitMode ? 'Current kit ready' : kitComplete ? 'Kit scanned' : 'Kit incomplete'}</Badge>
              <Badge tone={checklistComplete ? 'ok' : 'warning'}>{checklistComplete ? 'Re-check complete' : 'Re-check required'}</Badge>
              <button className="btn btn--primary" type="submit" disabled={!kitComplete || !checklistComplete}>
                Queue install event
              </button>
            </div>
          </Panel>
        </section>

        <section className="cockpit-grid__side">
          <Panel title={`Install sync queue (${pendingInstalls.length})`}>
            <DataTable
              columns={['Time', 'Truck', 'Mother', 'Status']}
              rows={pendingInstalls.map((item) => [
                formatClientTimestamp(item.clientTs),
                item.truckLabel ?? humanTruckValue(item.truckId),
                displayDeviceLabel(item.motherDeviceId) || (item.motherDeviceId ? 'Mother selected' : '-'),
                item.status,
              ])}
              emptyLabel="No queued installations on this device."
              pageSize={5}
            />
          </Panel>

          <Panel
            id="installation-history"
            title="Installation history archive"
            className="table-workbench"
            action={
              <div className="panel-actions">
                {showHistoryArchive && (
                  <Badge tone="muted">{historyLoading ? 'Loading' : `${installHistory.length ? historyPage * historyPageSize + 1 : 0}-${Math.min(historyTotal, (historyPage + 1) * historyPageSize)} of ${historyTotal}`}</Badge>
                )}
                <button className="btn btn--secondary btn--compact" type="button" onClick={() => setShowHistoryArchive((open) => !open)}>
                  {showHistoryArchive ? 'Close archive' : 'Open archive'}
                </button>
              </div>
            }
          >
            {showHistoryArchive ? (
              <>
            {historyError && <p className="banner banner--error">{historyError}</p>}
            <label>
              <span>Search installation history</span>
              <input
                value={historyQuery}
                onChange={(event) => {
                  setHistoryQuery(event.target.value);
                  setHistoryPage(0);
                }}
                placeholder="Truck, mother, sub-lock, status, or installer"
              />
            </label>
            <DataTable
              columns={['Installed', 'Truck', 'Mother', 'Sub-locks', 'Status', 'By']}
              rows={installHistory.map((item) => [
                formatTimestamp(item.loggedDate),
                item.truckLabel,
                item.motherSerial,
                item.subSerials.length ? item.subSerials.join(' / ') : '-',
                item.overallStatus ?? '-',
                item.actorName ?? '-',
              ])}
              emptyLabel="No completed installations have synced to the server yet."
              pagination={{
                page: historyPage,
                pageSize: historyPageSize,
                total: historyTotal,
                onPageChange: setHistoryPage,
                disabled: historyLoading,
              }}
            />
              </>
            ) : (
              <p className="empty-state">Open the full installation archive from Lookup when historical search is needed.</p>
            )}
          </Panel>

          <Panel title="Install rules">
            <StatusList
              items={[
                { label: 'Mother', value: 'Registered and available', tone: 'muted' },
                { label: 'Sub slots', value: 'B, C, D required', tone: 'muted' },
                { label: 'Conflict rule', value: 'Fail closed', tone: 'danger' },
                { label: 'Write path', value: 'Local queue first', tone: 'ok' },
              ]}
            />
          </Panel>
        </section>
      </form>
    </main>
  );
}

function humanTruckValue(value: string | null | undefined): string {
  if (!value) return '-';
  return value.startsWith('trk_') ? 'Loaded truck' : value;
}

function displayTruckLabel(...values: Array<string | null | undefined>): string {
  let hasInternalId = false;
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('trk_')) {
      hasInternalId = true;
      continue;
    }
    return trimmed;
  }
  return hasInternalId ? 'Loaded truck' : '';
}

function displayDeviceLabel(...values: Array<string | null | undefined>): string {
  let hasInternalId = false;
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (isInternalDeviceId(trimmed)) {
      hasInternalId = true;
      continue;
    }
    return trimmed;
  }
  return hasInternalId ? 'Selected device' : '';
}

function displaySubLockLabel(currentKit: CurrentTruckKit | null, subDeviceIds: InstallKitFormValues['subDeviceIds']): string {
  if (currentKit?.subs.length) {
    return currentKit.subs.map((sub) => sub.serial).filter(Boolean).join(' / ');
  }
  if (!subDeviceIds.every(Boolean)) return 'Not set';
  return subDeviceIds.some((value) => isInternalDeviceId(value)) ? 'All set' : subDeviceIds.join(' / ');
}

function isInternalDeviceId(value: string): boolean {
  return value.startsWith('dev_');
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
