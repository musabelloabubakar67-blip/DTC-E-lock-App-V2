'use client';

import { useEffect, useMemo, useState } from 'react';
import { offlineDb } from '../../../lib/offline/db';
import type { CreateFaultReportFormValues } from '../../../lib/validations/fault';
import {
  Badge,
  DataTable,
  IndustrialPageHeader,
  Panel,
  ScanInputRow,
  StatusList,
  TrustBanner,
} from '../_components/ProductUI';
import {
  fetchFaultHistory,
  fetchSupervisors,
  submitFaultReport,
  type FaultHistorySummary,
  type Supervisor,
} from './actions';

type FaultHistoryState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; data: FaultHistorySummary } | { status: 'error' };

type PendingFault = {
  id: string;
  truckId: string | null;
  deviceId: string | null;
  faultType: string | null;
  clientTs: number;
  status: 'pending';
};

const emptyForm: CreateFaultReportFormValues = {
  truckId: '',
  deviceId: '',
  locksAffected: [],
  description: '',
};

const lockOptions = ['MOTHER', 'B', 'C', 'D'] as const;

export default function FaultPage() {
  const [form, setForm] = useState<CreateFaultReportFormValues>(emptyForm);
  const [history, setHistory] = useState<FaultHistoryState>({ status: 'idle' });
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [pendingFaults, setPendingFaults] = useState<PendingFault[]>([]);
  const [result, setResult] = useState<{ status: 'idle' | 'queued' | 'error'; message?: string }>({ status: 'idle' });

  useEffect(() => {
    fetchSupervisors().then(setSupervisors);
  }, []);

  useEffect(() => {
    if (!form.deviceId) {
      setHistory({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setHistory({ status: 'loading' });
    fetchFaultHistory(form.deviceId).then((summary) => {
      if (cancelled) return;
      setHistory(summary ? { status: 'ready', data: summary } : { status: 'error' });
    });

    return () => {
      cancelled = true;
    };
  }, [form.deviceId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPendingFaults() {
      try {
        const rows = await offlineDb.mutations.where('status').equals('pending').sortBy('seq');
        if (cancelled) return;
        setPendingFaults(
          rows
            .filter((row) => row.endpoint === '/api/faults')
            .map((row) => {
              const payload = row.payload as Partial<CreateFaultReportFormValues> | null;
              return {
                id: row.id,
                truckId: typeof payload?.truckId === 'string' ? payload.truckId : null,
                deviceId: typeof payload?.deviceId === 'string' ? payload.deviceId : null,
                faultType: typeof payload?.faultType === 'string' ? payload.faultType : null,
                clientTs: row.clientTs,
                status: 'pending' as const,
              };
            }),
        );
      } catch {
        if (!cancelled) setPendingFaults([]);
      }
    }

    void loadPendingFaults();
    const interval = window.setInterval(loadPendingFaults, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [result]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setResult({ status: 'idle' });
    const outcome = await submitFaultReport(form);
    if (outcome.status === 'queued') {
      setResult({ status: 'queued' });
      setForm(emptyForm);
    } else {
      setResult({ status: 'error', message: outcome.message });
    }
  }

  function toggleLock(lock: string) {
    const current = new Set(form.locksAffected);
    if (current.has(lock)) {
      current.delete(lock);
    } else {
      current.add(lock);
    }
    setForm({ ...form, locksAffected: [...current] });
  }

  function updateOptionalField<K extends keyof CreateFaultReportFormValues>(
    key: K,
    value: CreateFaultReportFormValues[K] | '',
  ) {
    const next = { ...form };
    if (value === '') {
      delete next[key];
    } else {
      next[key] = value as CreateFaultReportFormValues[K];
    }
    setForm(next);
  }

  const draftComplete = Boolean(form.truckId && form.deviceId && form.locksAffected.length > 0 && form.description);
  const recurrenceTone = history.status === 'ready' && history.data.count > 0 ? 'danger' : 'muted';

  const statusItems = useMemo(
    () => [
      { label: 'Truck', value: humanTruckValue(form.truckId) || 'Not set', tone: form.truckId ? ('muted' as const) : ('danger' as const) },
      { label: 'Device', value: form.deviceId || 'Not set', tone: form.deviceId ? ('muted' as const) : ('danger' as const) },
      {
        label: 'Locks affected',
        value: form.locksAffected.length > 0 ? form.locksAffected.join(', ') : 'Not set',
        tone: form.locksAffected.length > 0 ? ('muted' as const) : ('danger' as const),
      },
      {
        label: 'Fault type',
        value: formatOption(form.faultType) || 'Not set',
        tone: form.faultType ? ('muted' as const) : ('danger' as const),
      },
      {
        label: 'Submit state',
        value: result.status === 'queued' ? 'QUEUED' : result.status === 'error' ? 'ERROR' : 'DRAFT',
        tone: result.status === 'queued' ? ('ok' as const) : result.status === 'error' ? ('danger' as const) : ('muted' as const),
      },
    ],
    [form, result.status],
  );

  return (
    <main className="fault-cockpit">
      <IndustrialPageHeader
        eyebrow="Incident capture and authority"
        title="Fault"
        accent="Report"
        metric={String(pendingFaults.length).padStart(2, '0')}
        description="Report device issues while preserving authority, assignment and repair history."
        status={<Badge tone={pendingFaults.length > 0 ? 'warning' : 'muted'}>{pendingFaults.length} pending</Badge>}
      />

      <TrustBanner
        empty={!draftComplete}
        emptyTitle="Fault draft incomplete"
        emptyBody="Enter the device, truck, affected locks, and description before queueing this report."
        state="unverified"
        latestVerifiedAt={null}
        weakestTier={null}
      />

      {result.status === 'queued' && <p className="banner banner--ok">Saved on device. Fault report is pending sync.</p>}
      {result.status === 'error' && <p className="banner banner--error">{`Error: ${result.message}`}</p>}

      <form className="fault-form cockpit-grid" onSubmit={handleSubmit}>
        <section className="cockpit-grid__primary">
          <Panel title="Device lookup">
            <ScanInputRow
              label="Device ID"
              prefix="D"
              value={form.deviceId}
              placeholder="Scan or enter mother/sub device ID"
              onChange={(value) => setForm({ ...form, deviceId: value })}
            />
            <label>
              <span>Truck plate</span>
              <input
                value={form.truckId}
                onChange={(event) => setForm({ ...form, truckId: event.target.value })}
                placeholder="Enter truck plate"
                required
              />
            </label>
          </Panel>

          <Panel title="Fault details">
            <div className="checklist-grid">
              <label>
                <span>Reported by</span>
                <select
                  value={form.reportedBy ?? ''}
                  onChange={(event) =>
                    updateOptionalField('reportedBy', event.target.value as CreateFaultReportFormValues['reportedBy'] | '')
                  }
                >
                  <option value="">Not set</option>
                  <option value="station_manager">Station manager</option>
                  <option value="customer_rep">Customer rep</option>
                  <option value="driver">Driver</option>
                  <option value="team_member">Team member</option>
                  <option value="self_identified">Self identified</option>
                </select>
              </label>
              <label>
                <span>Fault type</span>
                <select
                  value={form.faultType ?? ''}
                  onChange={(event) =>
                    updateOptionalField('faultType', event.target.value as CreateFaultReportFormValues['faultType'] | '')
                  }
                >
                  <option value="">Not set</option>
                  <option value="device_offline">Device offline</option>
                  <option value="dynamic_password_failed">Dynamic password failed</option>
                  <option value="sub_lock_not_opening">Sub-lock not opening</option>
                  <option value="charging_failure">Charging failure</option>
                  <option value="configuration_error">Configuration error</option>
                  <option value="hardware_damage">Hardware damage</option>
                  <option value="seal_discrepancy">Seal discrepancy</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                <span>Truck location</span>
                <select
                  value={form.truckLocation ?? ''}
                  onChange={(event) =>
                    updateOptionalField('truckLocation', event.target.value as CreateFaultReportFormValues['truckLocation'] | '')
                  }
                >
                  <option value="">Not set</option>
                  <option value="in_transit">In transit</option>
                  <option value="customer_location">Customer location</option>
                  <option value="installation_point">Installation point</option>
                </select>
              </label>
              <label>
                <span>Device online</span>
                <select
                  value={form.deviceOnline ?? ''}
                  onChange={(event) =>
                    updateOptionalField('deviceOnline', event.target.value as CreateFaultReportFormValues['deviceOnline'] | '')
                  }
                >
                  <option value="">Not set</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="intermittent">Intermittent</option>
                </select>
              </label>
            </div>

            <div className="lock-choice-grid" role="group" aria-label="Locks affected">
              {lockOptions.map((lock) => (
                <label className="choice-pill" key={lock}>
                  <input
                    type="checkbox"
                    checked={form.locksAffected.includes(lock)}
                    onChange={() => toggleLock(lock)}
                  />
                  <span>{lock}</span>
                </label>
              ))}
            </div>

            <label>
              <span>Description</span>
              <textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Describe the observed issue"
                required
              />
            </label>

            <div className="kit-panel__footer">
              <Badge tone="ok">Saved on device</Badge>
              <Badge tone={pendingFaults.length > 0 ? 'warning' : 'muted'}>{pendingFaults.length} pending sync</Badge>
              <button className="btn btn--primary" type="submit">
                Queue fault
              </button>
            </div>
          </Panel>
        </section>

        <section className="cockpit-grid__middle">
          <Panel title="Current fault status">
            <StatusList items={statusItems} />
          </Panel>

          <Panel title="Fault history">
            <StatusList
              items={[
                {
                  label: 'Prior fault removals',
                  value:
                    history.status === 'idle'
                      ? 'No device selected'
                      : history.status === 'loading'
                        ? 'Loading'
                        : history.status === 'error'
                          ? 'Unavailable'
                          : String(history.data.count),
                  tone: recurrenceTone as 'danger' | 'muted',
                },
                {
                  label: 'Most recent',
                  value:
                    history.status === 'ready' && history.data.mostRecentAt
                      ? `${daysAgo(history.data.mostRecentAt)} days ago`
                      : '-',
                  tone: recurrenceTone as 'danger' | 'muted',
                },
              ]}
            />
          </Panel>

          <Panel title="Authority">
            <div className="checklist-grid">
              <label>
                <span>Static password used</span>
                <select
                  value={form.staticPwUsed ?? ''}
                  onChange={(event) =>
                    updateOptionalField('staticPwUsed', event.target.value as CreateFaultReportFormValues['staticPwUsed'] | '')
                  }
                >
                  <option value="">N/A</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label>
                <span>Static password authorized by</span>
                <select
                  value={form.staticPwAuthBy ?? ''}
                  onChange={(event) => setForm({ ...form, staticPwAuthBy: event.target.value || null })}
                >
                  <option value="">N/A</option>
                  {supervisors.map((supervisor) => (
                    <option key={supervisor.id} value={supervisor.id}>
                      {supervisor.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Incident status</span>
                <select
                  value={form.incidentStatus ?? ''}
                  onChange={(event) =>
                    updateOptionalField('incidentStatus', event.target.value as CreateFaultReportFormValues['incidentStatus'] | '')
                  }
                >
                  <option value="">Not set</option>
                  <option value="closed">Closed</option>
                  <option value="open_pending_followup">Open pending follow-up</option>
                </select>
              </label>
              <label>
                <span>Closure confirmed by</span>
                <select
                  value={form.closureBy ?? ''}
                  onChange={(event) => setForm({ ...form, closureBy: event.target.value || null })}
                >
                  <option value="">N/A</option>
                  {supervisors.map((supervisor) => (
                    <option key={supervisor.id} value={supervisor.id}>
                      {supervisor.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Panel>
        </section>

        <section className="cockpit-grid__side">
          <Panel title={`Fault sync queue (${pendingFaults.length})`}>
            <DataTable
              columns={['Time', 'Truck', 'Device', 'Type', 'Status']}
              rows={pendingFaults.map((item) => [
                formatClientTimestamp(item.clientTs),
                humanTruckValue(item.truckId),
                item.deviceId ?? '-',
                formatOption(item.faultType) || '-',
                item.status,
              ])}
              emptyLabel="No queued fault reports on this device."
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

function daysAgo(unixSeconds: number): number {
  return Math.floor((Date.now() / 1000 - unixSeconds) / 86400);
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

function formatOption(value: string | null | undefined): string {
  if (!value) return '';
  return value.replaceAll('_', ' ');
}
