'use client';

import { useEffect, useMemo, useState } from 'react';
import { offlineDb } from '../../../lib/offline/db';
import type { RepairBatchFormValues } from '../../../lib/validations/repair';
import {
  Badge,
  DataTable,
  IndustrialPageHeader,
  Panel,
  ScanInputRow,
  StatusList,
} from '../_components/ProductUI';
import {
  fetchRepairTruck,
  submitRepairBatch,
  type RepairTruckKit,
} from './actions';
import {
  fetchRepairPool,
  submitTriage,
  type RepairPoolItem,
} from '../triage/actions';
import { useAppRole } from '../_components/AppShell';

type Position = 'mother' | 'B' | 'C' | 'D';
type PositionMode = 'replace' | 'remove';

const positions: Position[] = ['mother', 'B', 'C', 'D'];

export default function RepairsPage() {
  const role = useAppRole();
  const [truck, setTruck] = useState('');
  const [kit, setKit] = useState<RepairTruckKit | null>(null);
  const [loadingTruck, setLoadingTruck] = useState(false);
  const [selected, setSelected] = useState<Set<Position>>(new Set());
  const [modes, setModes] = useState<Record<Position, PositionMode>>({
    mother: 'replace',
    B: 'replace',
    C: 'replace',
    D: 'replace',
  });
  const [replacements, setReplacements] = useState<Record<Position, string>>({
    mother: '',
    B: '',
    C: '',
    D: '',
  });
  const [reason, setReason] = useState<'faulty' | 'damaged'>('faulty');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [pool, setPool] = useState<RepairPoolItem[]>([]);
  const [pending, setPending] = useState(0);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const contextualTruck = params.get('truck');
    if (contextualTruck) setTruck(contextualTruck);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const [repairPool, queued] = await Promise.all([
        fetchRepairPool(),
        offlineDb.mutations.where('status').equals('pending').toArray(),
      ]);
      if (cancelled) return;
      setPool(repairPool);
      setPending(queued.filter((item) => item.endpoint === '/api/repairs').length);
    }
    void refresh();
    const interval = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [result]);

  async function loadTruck() {
    if (!truck.trim()) return;
    setLoadingTruck(true);
    setResult(null);
    const loaded = await fetchRepairTruck(truck.trim());
    setLoadingTruck(false);
    if (!loaded?.mother) {
      setKit(null);
      setResult({ tone: 'error', message: `No active kit was found for ${truck.trim().toUpperCase()}.` });
      return;
    }
    setKit(loaded);
    setTruck(loaded.plate);
    setSelected(new Set());
    setReplacements({ mother: '', B: '', C: '', D: '' });
  }

  function currentSerial(position: Position): string | null {
    if (!kit) return null;
    if (position === 'mother') return kit.mother?.serial ?? null;
    return kit.subs.find((item) => item.slot === position)?.serial ?? null;
  }

  function toggle(position: Position) {
    if (!currentSerial(position)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  }

  function selectEntireKit() {
    if (!kit) return;
    const available = positions.filter((position) => currentSerial(position));
    setSelected(selected.size === available.length ? new Set() : new Set(available));
  }

  const items = useMemo<RepairBatchFormValues['items']>(
    () => positions
      .filter((position) => selected.has(position))
      .map((position) => ({
        position,
        ...(modes[position] === 'replace' && replacements[position].trim()
          ? { replacementSerial: replacements[position].trim().toUpperCase() }
          : {}),
      })),
    [modes, replacements, selected],
  );

  const replacementsComplete = [...selected].every(
    (position) => modes[position] === 'remove' || replacements[position].trim(),
  );
  const awaitingReplacement = [...selected].some(
    (position) => modes[position] === 'replace' && !replacements[position].trim(),
  );
  const kitCurrentlyIncomplete = Boolean(kit && positions.some((position) => !currentSerial(position)));
  const willBeIncomplete = kitCurrentlyIncomplete || [...selected].some(
    (position) => modes[position] === 'remove',
  );
  const ready = Boolean(kit && items.length > 0 && description.trim() && replacementsComplete);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!kit || !ready) return;
    setWorking(true);
    setResult(null);
    const outcome = await submitRepairBatch({
      truck: kit.plate,
      reason,
      description: description.trim(),
      notes: notes.trim() || undefined,
      items,
    });
    setWorking(false);
    if (outcome.status === 'error') {
      setResult({ tone: 'error', message: outcome.message });
      return;
    }
    setResult({
      tone: 'ok',
      message: `${items.length} repair operation${items.length === 1 ? '' : 's'} saved on this device and queued for sync.`,
    });
    setSelected(new Set());
    setDescription('');
    setNotes('');
  }

  async function triage(deviceId: string, outcome: 'revived' | 'dead') {
    setWorking(true);
    const response = await submitTriage(deviceId, outcome);
    setWorking(false);
    setResult(response.status === 'queued'
      ? { tone: 'ok', message: outcome === 'revived' ? 'Return-to-service decision queued.' : 'Unusable-device decision queued.' }
      : { tone: 'error', message: response.message });
  }

  return (
    <main className="fault-cockpit">
      <IndustrialPageHeader
        eyebrow="Hardware lifecycle"
        title="Repair"
        accent="Shop"
        metric={String(pool.length).padStart(2, '0')}
        description="Remove or replace one device, several positions, or an entire installed kit in one operation."
        status={<Badge tone={pending ? 'warning' : 'muted'}>{pending} repair operations queued</Badge>}
      />

      {result && <p className={`banner banner--${result.tone}`}>{result.message}</p>}

      <form className="repair-workbench" onSubmit={submit}>
        <Panel title="1 / Load installed kit">
          <div className="repair-truck-loader">
            <label>
              <span>Truck plate</span>
              <input value={truck} onChange={(event) => setTruck(event.target.value.toUpperCase())} placeholder="FZE245DI" />
            </label>
            <button className="btn btn--primary" type="button" disabled={!truck.trim() || loadingTruck} onClick={loadTruck}>
              {loadingTruck ? 'Loading' : 'Load kit'}
            </button>
          </div>
        </Panel>

        <Panel
          title="2 / Select devices"
          action={kit ? <button className="btn btn--secondary" type="button" onClick={selectEntireKit}>Select entire kit</button> : undefined}
        >
          <div className="repair-device-grid">
            {positions.map((position) => {
              const serial = currentSerial(position);
              const active = selected.has(position);
              return (
                <section className={`repair-device ${active ? 'repair-device--selected' : ''}`} key={position}>
                  <label className="repair-device__select">
                    <input type="checkbox" checked={active} disabled={!serial} onChange={() => toggle(position)} />
                    <span>{position === 'mother' ? 'Mother lock' : `Sub-lock ${position}`}</span>
                    <strong>{serial ?? 'Not installed'}</strong>
                  </label>
                </section>
              );
            })}
          </div>
          {selected.size > 0 && (
            <div className="repair-operation-list">
              {positions.filter((position) => selected.has(position)).map((position) => (
                <section className="repair-operation-row" key={position}>
                  <div className="repair-operation-row__device">
                    <span>{position === 'mother' ? 'Mother lock' : `Sub-lock ${position}`}</span>
                    <strong>{currentSerial(position)}</strong>
                  </div>
                  <label>
                    <span>Operation</span>
                    <select
                      value={modes[position]}
                      onChange={(event) => setModes({ ...modes, [position]: event.target.value as PositionMode })}
                    >
                      <option value="replace">Replace now</option>
                      <option value="remove">Remove only</option>
                    </select>
                  </label>
                  {modes[position] === 'replace' ? (
                    <ScanInputRow
                      label="Replacement serial"
                      prefix={position === 'mother' ? 'M' : position}
                      value={replacements[position]}
                      placeholder={`Scan replacement ${position === 'mother' ? 'mother' : position}`}
                      onChange={(value) => setReplacements({ ...replacements, [position]: value.toUpperCase() })}
                    />
                  ) : (
                    <p className="repair-operation-row__notice">Position will remain empty until a replacement is installed.</p>
                  )}
                </section>
              ))}
            </div>
          )}
        </Panel>

        <div className="repair-detail-grid">
          <Panel title="3 / Reason and notes">
            <label>
              <span>Reason</span>
              <select value={reason} onChange={(event) => setReason(event.target.value as 'faulty' | 'damaged')}>
                <option value="faulty">Faulty</option>
                <option value="damaged">Damaged</option>
              </select>
            </label>
            <label>
              <span>What happened?</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Required description" />
            </label>
            <label>
              <span>Additional notes</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional field notes" />
            </label>
          </Panel>

          <Panel title="4 / Before and after">
            <StatusList items={[
              { label: 'Truck', value: kit?.plate ?? 'Not loaded', tone: kit ? 'muted' : 'danger' },
              { label: 'Selected', value: items.length ? items.map((item) => item.position.toUpperCase()).join(', ') : 'None', tone: items.length ? 'muted' : 'danger' },
              { label: 'Repair pool', value: `${items.length} outgoing`, tone: items.length ? 'danger' : 'muted' },
              {
                label: 'Kit state',
                value: awaitingReplacement
                  ? 'ADD REPLACEMENT SERIALS'
                  : willBeIncomplete
                    ? 'INCOMPLETE AFTER SAVE'
                    : 'COMPLETE AFTER SAVE',
                tone: awaitingReplacement || willBeIncomplete ? 'danger' : 'ok',
              },
            ]} />
            <button className="btn btn--primary repair-submit" type="submit" disabled={!ready || working}>
              {working ? 'Saving operation' : `Confirm ${items.length || ''} repair operation${items.length === 1 ? '' : 's'}`}
            </button>
          </Panel>
        </div>
      </form>

      <Panel title={`Repair pool / ${pool.length}`}>
        <DataTable
          columns={['Device', 'Type', 'Entered repair', 'Reason', 'Disposition']}
          rows={pool.map((item) => [
            item.serial,
            item.deviceType,
            item.enteredRepairAt ? formatDate(item.enteredRepairAt) : '-',
            item.removalReason?.replaceAll('_', ' ') ?? '-',
            role === 'supervisor' ? (
              <div className="repair-pool-actions" key={item.deviceId}>
                <button className="btn btn--secondary" type="button" disabled={working} onClick={() => triage(item.deviceId, 'revived')}>Return to service</button>
                <button className="btn btn--danger" type="button" disabled={working} onClick={() => triage(item.deviceId, 'dead')}>Declare unusable</button>
              </div>
            ) : (
              <span key={item.deviceId}>Supervisor disposition required</span>
            ),
          ])}
          emptyLabel="No devices are awaiting repair disposition."
        />
      </Panel>
    </main>
  );
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value * 1000));
}
