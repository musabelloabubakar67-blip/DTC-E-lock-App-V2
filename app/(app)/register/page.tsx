'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RegisterKitFormValues } from '../../../lib/validations/registration';
import {
  Badge,
  DataTable,
  Panel,
  ScanInputRow,
  StatusList,
  TrustBanner,
  formatTimestamp,
} from '../_components/ProductUI';
import { submitRegistrationKit, type SubmitRegistrationResult } from './actions';

type KitListEntry = {
  id: number;
  values: RegisterKitFormValues;
  result: SubmitRegistrationResult | { status: 'pending' };
};

type RegistrationListItem = {
  id: string;
  loggedDate: number;
  motherSerial: string;
  subSerials: string[];
  simNumber: string | null;
  source: 'app' | 'import';
  actorName: string | null;
  ownershipStatus: 'owned' | 'released_external' | 'mixed';
  ownershipNotes: string | null;
};

type ConfigKey = keyof Pick<
  RegisterKitFormValues,
  'ipConfigured' | 'apnConfigured' | 'apnAuthSet' | 'btWriteDone'
>;

const emptyForm: RegisterKitFormValues = {
  motherSerial: '',
  subSerials: ['', '', ''],
  simNumber: '',
};

const subSlots = ['B', 'C', 'D'] as const;

let nextEntryId = 1;

export default function RegisterPage() {
  const [form, setForm] = useState<RegisterKitFormValues>(emptyForm);
  const [kitList, setKitList] = useState<KitListEntry[]>([]);
  const [registryRows, setRegistryRows] = useState<RegistrationListItem[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [registryQuery, setRegistryQuery] = useState('');
  const [ownershipWorkingId, setOwnershipWorkingId] = useState<string | null>(null);
  const [selectedRegistryIds, setSelectedRegistryIds] = useState<Set<string>>(() => new Set());
  const [batchWorking, setBatchWorking] = useState(false);
  const [releaseDraft, setReleaseDraft] = useState<{ registrationIds: string[]; label: string } | null>(null);
  const [releaseNote, setReleaseNote] = useState('');

  useEffect(() => {
    void loadRegistry();
  }, []);

  useEffect(() => {
    setSelectedRegistryIds((current) => {
      const availableIds = new Set(registryRows.map((row) => row.id));
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [registryRows]);

  async function loadRegistry() {
    try {
      const response = await fetch('/api/registry', { cache: 'no-store' });
      if (!response.ok) throw new Error('registry_failed');
      const payload = (await response.json()) as { data?: RegistrationListItem[] };
      setRegistryRows(Array.isArray(payload.data) ? payload.data : []);
      setRegistryError(null);
    } catch {
      setRegistryRows([]);
      setRegistryError('Registered kits could not be loaded.');
    }
  }

  async function submitEntry(entryId: number, values: RegisterKitFormValues) {
    setKitList((list) =>
      list.map((entry) => (entry.id === entryId ? { ...entry, result: { status: 'pending' } } : entry)),
    );
    const result = await submitRegistrationKit(values);
    setKitList((list) => list.map((entry) => (entry.id === entryId ? { ...entry, result } : entry)));
    if (result.status === 'success') {
      await loadRegistry();
    }
  }

  async function submitOwnershipUpdate(
    registrationIds: string[],
    ownershipStatus: 'owned' | 'released_external',
    notes: string,
  ) {
    if (registrationIds.length === 0) return;
    setOwnershipWorkingId(registrationIds.length === 1 ? registrationIds[0] : null);
    setBatchWorking(registrationIds.length > 1);
    setRegistryError(null);
    try {
      const response = await fetch('/api/registry/ownership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationIds, ownershipStatus, notes }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Ownership update failed');
      setSelectedRegistryIds((current) => {
        const next = new Set(current);
        for (const registrationId of registrationIds) next.delete(registrationId);
        return next;
      });
      setReleaseDraft(null);
      setReleaseNote('');
      await loadRegistry();
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : 'Ownership update failed');
    } finally {
      setOwnershipWorkingId(null);
      setBatchWorking(false);
    }
  }

  function updateOwnership(row: RegistrationListItem, ownershipStatus: 'owned' | 'released_external') {
    if (ownershipStatus === 'released_external') {
      setReleaseDraft({ registrationIds: [row.id], label: row.motherSerial });
      setReleaseNote(row.ownershipNotes ?? '');
      return;
    }
    void submitOwnershipUpdate([row.id], 'owned', '');
  }

  function updateSelectedOwnership(ownershipStatus: 'owned' | 'released_external') {
    const registrationIds = [...selectedRegistryIds];
    if (registrationIds.length === 0) return;
    if (ownershipStatus === 'released_external') {
      setReleaseDraft({ registrationIds, label: `${registrationIds.length} selected kit(s)` });
      setReleaseNote('');
      return;
    }
    void submitOwnershipUpdate(registrationIds, 'owned', '');
  }

  function toggleRegistrySelection(id: string, checked: boolean) {
    setSelectedRegistryIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function selectVisibleRegistryRows() {
    setSelectedRegistryIds((current) => {
      const next = new Set(current);
      for (const row of filteredRegistryRows) next.add(row.id);
      return next;
    });
  }

  function handleAddToKitList() {
    const entryId = nextEntryId++;
    const values: RegisterKitFormValues = {
      ...form,
      subSerials: [...form.subSerials] as [string, string, string],
    };
    setKitList((list) => [...list, { id: entryId, values, result: { status: 'pending' } }]);
    setForm(emptyForm);
    void submitEntry(entryId, values);
  }

  function handleRetry(entryId: number, values: RegisterKitFormValues) {
    void submitEntry(entryId, values);
  }

  function updateSubSerial(slotIndex: number, value: string) {
    const next = [...form.subSerials] as [string, string, string];
    next[slotIndex] = value;
    setForm({ ...form, subSerials: next });
  }

  function updateConfig(key: ConfigKey, value: 'yes' | 'no' | '') {
    const next = { ...form };
    if (value === '') {
      delete next[key];
    } else {
      next[key] = value;
    }
    setForm(next);
  }

  const kitComplete = Boolean(form.motherSerial && form.simNumber && form.subSerials.every(Boolean));
  const configCount = [form.ipConfigured, form.apnConfigured, form.apnAuthSet, form.btWriteDone].filter(Boolean).length;
  const pendingCount = kitList.filter((entry) => entry.result.status === 'pending').length;
  const successCount = kitList.filter((entry) => entry.result.status === 'success').length;
  const errorCount = kitList.filter((entry) => entry.result.status === 'error').length;
  const filteredRegistryRows = useMemo(
    () => filterRows(registryRows, registryQuery, (row) => [
      row.motherSerial,
      row.subSerials.join(' '),
      row.simNumber ?? '',
      row.actorName ?? '',
      row.source,
      ownershipLabel(row),
      row.ownershipNotes ?? '',
      formatTimestamp(row.loggedDate),
    ]),
    [registryRows, registryQuery],
  );

  const statusItems = useMemo(
    () => [
      {
        label: 'Mother serial',
        value: form.motherSerial || 'Not set',
        tone: form.motherSerial ? ('muted' as const) : ('danger' as const),
      },
      {
        label: 'Sub-lock serials',
        value: form.subSerials.every(Boolean) ? 'All set' : 'Not set',
        tone: form.subSerials.every(Boolean) ? ('muted' as const) : ('danger' as const),
      },
      {
        label: 'SIM number',
        value: form.simNumber || 'Not set',
        tone: form.simNumber ? ('muted' as const) : ('danger' as const),
      },
      {
        label: 'Config checks',
        value: `${configCount}/4`,
        tone: configCount === 4 ? ('ok' as const) : ('muted' as const),
      },
      {
        label: 'Write path',
        value: 'ONLINE ONLY',
        tone: 'danger' as const,
      },
    ],
    [configCount, form],
  );

  return (
    <main className="register-cockpit">
      <div className="lookup-cockpit__header">
        <div>
          <h1>Register</h1>
          <p>One kit at a time</p>
        </div>
        <Badge tone={errorCount > 0 ? 'danger' : pendingCount > 0 ? 'warning' : 'muted'}>
          {successCount} registered
        </Badge>
      </div>

      <TrustBanner
        empty={!kitComplete}
        emptyTitle="Registration draft incomplete"
        emptyBody="Enter the mother serial, three sub-lock serials, and SIM number before saving this kit."
        state="unverified"
        latestVerifiedAt={null}
        weakestTier={null}
      />

      <form
        className="register-form cockpit-grid"
        onSubmit={(event) => {
          event.preventDefault();
          handleAddToKitList();
        }}
      >
        <section className="cockpit-grid__primary">
          <Panel title="Kit capture" className="kit-panel">
            <ScanInputRow
              label="Mother lock"
              prefix="M"
              value={form.motherSerial}
              placeholder="Scan or enter mother serial"
              onChange={(value) => setForm({ ...form, motherSerial: value })}
            />
            {subSlots.map((slot, index) => (
              <ScanInputRow
                key={slot}
                label={`Sub-lock ${slot}`}
                prefix={slot}
                value={form.subSerials[index]}
                placeholder={`Scan or enter sub-lock ${slot} serial`}
                onChange={(value) => updateSubSerial(index, value)}
              />
            ))}
            <label>
              <span>SIM number</span>
              <input
                value={form.simNumber}
                onChange={(event) => setForm({ ...form, simNumber: event.target.value })}
                placeholder="Enter SIM number"
                required
              />
            </label>
            <div className="kit-panel__footer">
              <Badge tone="danger">Online write</Badge>
              <Badge tone={pendingCount > 0 ? 'warning' : 'muted'}>{pendingCount} saving</Badge>
              <button className="btn btn--primary" type="submit">
                Save kit
              </button>
            </div>
          </Panel>

          <Panel title="Kits this session">
            <div className="session-stack">
              {kitList.length === 0 && <p className="empty-state">No kits submitted in this session.</p>}
              {kitList.map((entry) => (
                <article className="session-card" key={entry.id}>
                  <div>
                    <strong>{entry.values.motherSerial}</strong>
                    <span>{entry.values.subSerials.join(' / ')}</span>
                  </div>
                  {entry.result.status === 'pending' && <Badge tone="warning">Saving</Badge>}
                  {entry.result.status === 'success' && <Badge tone="ok">Registered</Badge>}
                  {entry.result.status === 'error' && (
                    <div className="session-card__error">
                      <Badge tone="danger">Failed</Badge>
                      <p>{entry.result.message}</p>
                      <button type="button" className="btn btn--secondary btn--compact" onClick={() => handleRetry(entry.id, entry.values)}>
                        Retry
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </Panel>
        </section>

        <section className="cockpit-grid__middle">
          <Panel title="Draft status">
            <StatusList items={statusItems} />
          </Panel>

          <Panel title="Configuration">
            <div className="checklist-grid">
              <ConfigSelect
                label="IP configured"
                value={form.ipConfigured}
                onChange={(value) => updateConfig('ipConfigured', value)}
              />
              <ConfigSelect
                label="APN configured"
                value={form.apnConfigured}
                onChange={(value) => updateConfig('apnConfigured', value)}
              />
              <ConfigSelect
                label="APN auth set"
                value={form.apnAuthSet}
                onChange={(value) => updateConfig('apnAuthSet', value)}
              />
              <ConfigSelect
                label="BT write done"
                value={form.btWriteDone}
                onChange={(value) => updateConfig('btWriteDone', value)}
              />
            </div>
          </Panel>
        </section>

        <section className="cockpit-grid__side">
          <Panel title="Session summary">
            <DataTable
              columns={['State', 'Count']}
              rows={[
                ['Registered', successCount],
                ['Saving', pendingCount],
                ['Failed', errorCount],
              ]}
              emptyLabel="No session activity yet."
            />
          </Panel>

          <Panel title="Registered kits" className="table-workbench" action={<Badge tone="muted">{filteredRegistryRows.length} of {registryRows.length}</Badge>}>
            {registryError && <p className="banner banner--error">{registryError}</p>}
            <label>
              <span>Search registered kits</span>
              <input
                value={registryQuery}
                onChange={(event) => setRegistryQuery(event.target.value)}
                placeholder="Mother, sub-lock, SIM, source, or installer"
              />
            </label>
            <div className="registry-batch-bar">
              <Badge tone={selectedRegistryIds.size > 0 ? 'warning' : 'muted'}>{selectedRegistryIds.size} selected</Badge>
              <button className="btn btn--secondary btn--compact" type="button" onClick={selectVisibleRegistryRows} disabled={batchWorking || filteredRegistryRows.length === 0}>
                Select visible
              </button>
              <button className="btn btn--secondary btn--compact" type="button" onClick={() => setSelectedRegistryIds(new Set())} disabled={batchWorking || selectedRegistryIds.size === 0}>
                Clear
              </button>
              <button className="btn btn--secondary btn--compact" type="button" onClick={() => void updateSelectedOwnership('released_external')} disabled={batchWorking || selectedRegistryIds.size === 0}>
                Batch release
              </button>
              <button className="btn btn--secondary btn--compact" type="button" onClick={() => void updateSelectedOwnership('owned')} disabled={batchWorking || selectedRegistryIds.size === 0}>
                Restore selected
              </button>
            </div>
            {releaseDraft && (
              <div className="registry-release-note">
                <label>
                  <span>Release note for {releaseDraft.label}</span>
                  <textarea
                    value={releaseNote}
                    onChange={(event) => setReleaseNote(event.target.value)}
                    placeholder="Company, handover reference, or reason this kit is no longer available to DTC"
                  />
                </label>
                <div className="registry-batch-bar">
                  <button
                    className="btn btn--primary btn--compact"
                    type="button"
                    disabled={batchWorking || Boolean(ownershipWorkingId)}
                    onClick={() => void submitOwnershipUpdate(releaseDraft.registrationIds, 'released_external', releaseNote)}
                  >
                    Confirm release
                  </button>
                  <button
                    className="btn btn--secondary btn--compact"
                    type="button"
                    disabled={batchWorking || Boolean(ownershipWorkingId)}
                    onClick={() => {
                      setReleaseDraft(null);
                      setReleaseNote('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <DataTable
              columns={['Pick', 'Registered', 'Mother', 'Sub-locks', 'SIM', 'Ownership', 'By', 'Action']}
              rows={filteredRegistryRows.map((row) => [
                <input
                  aria-label={`Select ${row.motherSerial}`}
                  checked={selectedRegistryIds.has(row.id)}
                  disabled={batchWorking || ownershipWorkingId === row.id}
                  type="checkbox"
                  onChange={(event) => toggleRegistrySelection(row.id, event.target.checked)}
                />,
                formatTimestamp(row.loggedDate),
                row.motherSerial,
                row.subSerials.length ? row.subSerials.join(' / ') : '-',
                row.simNumber ?? '-',
                ownershipLabel(row),
                row.actorName ?? row.source,
                <button
                  className="btn btn--secondary btn--compact"
                  disabled={ownershipWorkingId === row.id}
                  type="button"
                  onClick={() => updateOwnership(row, row.ownershipStatus === 'released_external' ? 'owned' : 'released_external')}
                >
                  {row.ownershipStatus === 'released_external' ? 'Restore' : 'Release'}
                </button>,
              ])}
              emptyLabel="No registered kits found yet."
            />
          </Panel>

          <Panel title="Register rules">
            <StatusList
              items={[
                { label: 'Truck', value: 'Not assigned here', tone: 'muted' },
                { label: 'Slots', value: 'Unslotted kit members', tone: 'muted' },
                { label: 'Duplicate serial', value: 'Rejected', tone: 'danger' },
                { label: 'Offline behavior', value: 'Fails loudly', tone: 'danger' },
              ]}
            />
          </Panel>
        </section>
      </form>
    </main>
  );
}

function ownershipLabel(row: RegistrationListItem): string {
  if (row.ownershipStatus === 'released_external') return row.ownershipNotes ? `Released - ${row.ownershipNotes}` : 'Released';
  if (row.ownershipStatus === 'mixed') return 'Mixed ownership';
  return 'Owned';
}

function filterRows<T>(rows: T[], query: string, fields: (row: T) => string[]): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  return rows.filter((row) => {
    const haystack = fields(row).join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function ConfigSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: 'yes' | 'no';
  onChange: (value: 'yes' | 'no' | '') => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value as 'yes' | 'no' | '')}>
        <option value="">Not checked</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}
