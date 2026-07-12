'use client';

import { useEffect, useMemo, useState } from 'react';
import { offlineDb } from '../../../lib/offline/db';
import type { MovementActionFormValues } from '../../../lib/validations/movement';
import {
  Badge,
  DataTable,
  Panel,
  ScanInputRow,
  StatusList,
  TrustBanner,
} from '../_components/ProductUI';
import { submitMovement, type SubmitMovementResult } from './actions';

type ActionKind = MovementActionFormValues['kind'];
type RemovalReason = 'faulty' | 'damaged' | 'operational_swap' | 'decommissioned' | 'unlogged_swap_detected' | 'other';
type Disposition = 'repair_pool' | 'available_pool' | 'retired';

type PendingMovement = {
  id: string;
  kind: string | null;
  truckId: string | null;
  deviceId: string | null;
  clientTs: number;
  status: 'pending';
};

const ACTIONS: Array<{ kind: ActionKind; label: string; detail: string }> = [
  { kind: 'new_assignment', label: 'New assignment', detail: 'Assign mother to empty truck' },
  { kind: 'mother_replacement', label: 'Mother replacement', detail: 'Replace current mother lock' },
  { kind: 'sub_replacement', label: 'Sub replacement', detail: 'Replace B/C/D sub-lock' },
  { kind: 'truck_swap', label: 'Truck swap', detail: 'Move mother to another truck' },
  { kind: 'removed_to_inventory', label: 'Remove to inventory', detail: 'Leave source truck device-less' },
  { kind: 'decommissioned', label: 'Decommission', detail: 'Retire assigned mother' },
];

const REMOVAL_REASONS: RemovalReason[] = [
  'faulty',
  'damaged',
  'operational_swap',
  'decommissioned',
  'unlogged_swap_detected',
  'other',
];

const DISPOSITIONS: Disposition[] = ['repair_pool', 'available_pool', 'retired'];

export default function MovementPage() {
  const [kind, setKind] = useState<ActionKind>('new_assignment');
  const [truckId, setTruckId] = useState('');
  const [motherDeviceId, setMotherDeviceId] = useState('');
  const [newMotherDeviceId, setNewMotherDeviceId] = useState('');
  const [slot, setSlot] = useState<'B' | 'C' | 'D'>('B');
  const [newSubDeviceId, setNewSubDeviceId] = useState('');
  const [reason, setReason] = useState<RemovalReason>('operational_swap');
  const [disposition, setDisposition] = useState<Disposition | ''>('');
  const [toTruckId, setToTruckId] = useState('');
  const [notes, setNotes] = useState('');
  const [faultDescription, setFaultDescription] = useState('');
  const [pendingMovements, setPendingMovements] = useState<PendingMovement[]>([]);
  const [result, setResult] = useState<SubmitMovementResult | { status: 'idle' }>({ status: 'idle' });

  const isFaultReason = reason === 'faulty' || reason === 'damaged';
  const selectedAction = ACTIONS.find((action) => action.kind === kind)!;

  useEffect(() => {
    let cancelled = false;

    async function loadPendingMovements() {
      try {
        const rows = await offlineDb.mutations.where('status').equals('pending').sortBy('seq');
        if (cancelled) return;
        setPendingMovements(
          rows
            .filter((row) => row.endpoint === '/api/movements')
            .map((row) => {
              const payload = row.payload as Partial<MovementActionFormValues> | null;
              return {
                id: row.id,
                kind: typeof payload?.kind === 'string' ? payload.kind : null,
                truckId: readTruckId(payload),
                deviceId: readDeviceId(payload),
                clientTs: row.clientTs,
                status: 'pending' as const,
              };
            }),
        );
      } catch {
        if (!cancelled) setPendingMovements([]);
      }
    }

    void loadPendingMovements();
    const interval = window.setInterval(loadPendingMovements, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [result]);

  function buildPayload(): MovementActionFormValues | null {
    const notesValue = notes || undefined;
    const dispositionValue = disposition || undefined;

    switch (kind) {
      case 'new_assignment':
        if (!truckId || !motherDeviceId) return null;
        return { kind, truckId, motherDeviceId };
      case 'mother_replacement':
        if (!truckId || !newMotherDeviceId) return null;
        return { kind, truckId, newMotherDeviceId, reason, disposition: dispositionValue, notes: notesValue };
      case 'sub_replacement':
        if (!truckId || !motherDeviceId || !newSubDeviceId) return null;
        if (isFaultReason && !faultDescription) return null;
        return {
          kind,
          truckId,
          motherDeviceId,
          slot,
          newSubDeviceId,
          reason,
          disposition: dispositionValue,
          notes: notesValue,
          faultDetails: isFaultReason ? { description: faultDescription, locksAffected: [slot] } : undefined,
        };
      case 'truck_swap':
        if (!motherDeviceId || !toTruckId) return null;
        return { kind, deviceId: motherDeviceId, toTruckId };
      case 'removed_to_inventory':
        if (!motherDeviceId) return null;
        return { kind, motherDeviceId, reason, disposition: dispositionValue, notes: notesValue };
      case 'decommissioned':
        if (!motherDeviceId) return null;
        return { kind, motherDeviceId, notes: notesValue };
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setResult({ status: 'idle' });
    const payload = buildPayload();
    if (!payload) {
      setResult({ status: 'error', message: 'Complete the required movement fields before queueing.' });
      return;
    }

    const outcome = await submitMovement(payload);
    setResult(outcome);
  }

  const draftPayload = buildPayload();
  const draftComplete = Boolean(draftPayload);

  const statusItems = useMemo(
    () => [
      { label: 'Action', value: selectedAction.label, tone: 'muted' as const },
      {
        label: 'Truck',
        value: truckId || toTruckId || 'Not set',
        tone: truckId || toTruckId ? ('muted' as const) : ('danger' as const),
      },
      {
        label: 'Mother/device',
        value: motherDeviceId || newMotherDeviceId || 'Not set',
        tone: motherDeviceId || newMotherDeviceId ? ('muted' as const) : ('danger' as const),
      },
      {
        label: 'Reason',
        value: actionNeedsReason(kind) ? formatOption(reason) : 'N/A',
        tone: actionNeedsReason(kind) ? ('muted' as const) : ('muted' as const),
      },
      {
        label: 'Submit state',
        value: result.status === 'queued' ? 'QUEUED' : result.status === 'error' ? 'ERROR' : 'DRAFT',
        tone: result.status === 'queued' ? ('ok' as const) : result.status === 'error' ? ('danger' as const) : ('muted' as const),
      },
    ],
    [kind, motherDeviceId, newMotherDeviceId, reason, result.status, selectedAction.label, toTruckId, truckId],
  );

  return (
    <main className="movement-cockpit">
      <div className="lookup-cockpit__header">
        <div>
          <h1>Movement</h1>
          <p>{selectedAction.detail}</p>
        </div>
        <Badge tone={pendingMovements.length > 0 ? 'warning' : 'muted'}>{pendingMovements.length} pending</Badge>
      </div>

      <TrustBanner
        empty={!draftComplete}
        emptyTitle="Movement draft incomplete"
        emptyBody="Choose an action and enter the required truck/device fields before queueing the movement."
        state="unverified"
        latestVerifiedAt={null}
        weakestTier={null}
      />

      {result.status === 'queued' && <p className="banner banner--ok">Saved on device. Movement is pending sync.</p>}
      {result.status === 'error' && <p className="banner banner--error">{`Error: ${result.message}`}</p>}

      <form className="movement-form cockpit-grid" onSubmit={handleSubmit}>
        <section className="cockpit-grid__primary">
          <Panel title="Action">
            <div className="mode-grid" role="radiogroup" aria-label="Movement action">
              {ACTIONS.map((action) => (
                <button
                  className="mode-card"
                  data-active={kind === action.kind}
                  key={action.kind}
                  type="button"
                  role="radio"
                  aria-checked={kind === action.kind}
                  onClick={() => setKind(action.kind)}
                >
                  <strong>{action.label}</strong>
                  <span>{action.detail}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Movement details">
            {(kind === 'new_assignment' || kind === 'mother_replacement' || kind === 'sub_replacement') && (
              <label>
                <span>Truck ID</span>
                <input value={truckId} onChange={(event) => setTruckId(event.target.value)} placeholder="Enter truck ID" />
              </label>
            )}

            {(kind === 'new_assignment' ||
              kind === 'sub_replacement' ||
              kind === 'truck_swap' ||
              kind === 'removed_to_inventory' ||
              kind === 'decommissioned') && (
              <ScanInputRow
                label={kind === 'truck_swap' ? 'Mother being moved' : 'Mother lock'}
                prefix="M"
                value={motherDeviceId}
                placeholder={kind === 'truck_swap' ? 'Scan or enter mother device ID' : 'Scan or enter mother device ID'}
                onChange={setMotherDeviceId}
              />
            )}

            {kind === 'mother_replacement' && (
              <ScanInputRow
                label="New mother lock"
                prefix="M"
                value={newMotherDeviceId}
                placeholder="Scan or enter new mother device ID"
                onChange={setNewMotherDeviceId}
              />
            )}

            {kind === 'sub_replacement' && (
              <div className="checklist-grid">
                <label>
                  <span>Slot</span>
                  <select value={slot} onChange={(event) => setSlot(event.target.value as 'B' | 'C' | 'D')}>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="D">D</option>
                  </select>
                </label>
                <label>
                  <span>New sub device ID</span>
                  <input
                    value={newSubDeviceId}
                    onChange={(event) => setNewSubDeviceId(event.target.value)}
                    placeholder="Enter new sub device ID"
                  />
                </label>
              </div>
            )}

            {kind === 'truck_swap' && (
              <label>
                <span>To truck ID</span>
                <input value={toTruckId} onChange={(event) => setToTruckId(event.target.value)} placeholder="Destination truck ID" />
              </label>
            )}

            {actionNeedsReason(kind) && (
              <div className="checklist-grid">
                <label>
                  <span>Reason</span>
                  <select value={reason} onChange={(event) => setReason(event.target.value as RemovalReason)}>
                    {REMOVAL_REASONS.map((value) => (
                      <option key={value} value={value}>
                        {formatOption(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Disposition</span>
                  <select value={disposition} onChange={(event) => setDisposition(event.target.value as Disposition | '')}>
                    <option value="">Service default</option>
                    {DISPOSITIONS.map((value) => (
                      <option key={value} value={value}>
                        {formatOption(value)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {kind !== 'new_assignment' && kind !== 'truck_swap' && (
              <label>
                <span>Notes</span>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Movement notes" />
              </label>
            )}

            <div className="kit-panel__footer">
              <Badge tone="ok">Saved on device</Badge>
              <Badge tone={pendingMovements.length > 0 ? 'warning' : 'muted'}>{pendingMovements.length} pending sync</Badge>
              <button className="btn btn--primary" type="submit">
                Queue movement
              </button>
            </div>
          </Panel>
        </section>

        <section className="cockpit-grid__middle">
          <Panel title="Movement status">
            <StatusList items={statusItems} />
          </Panel>

          <Panel title="Fault-linked replacement">
            <StatusList
              items={[
                {
                  label: 'Applies to',
                  value: kind === 'sub_replacement' ? 'Sub replacement' : 'Sub replacement only',
                  tone: kind === 'sub_replacement' ? 'muted' : 'danger',
                },
                {
                  label: 'Fault reason',
                  value: isFaultReason ? 'YES' : 'NO',
                  tone: isFaultReason ? 'danger' : 'muted',
                },
                {
                  label: 'Linked fault report',
                  value: kind === 'sub_replacement' && isFaultReason ? 'Required' : 'Not created',
                  tone: kind === 'sub_replacement' && isFaultReason ? 'danger' : 'muted',
                },
              ]}
            />
            {kind === 'sub_replacement' && isFaultReason && (
              <label>
                <span>Fault description</span>
                <textarea
                  value={faultDescription}
                  onChange={(event) => setFaultDescription(event.target.value)}
                  placeholder="Required for faulty/damaged sub replacement"
                />
              </label>
            )}
          </Panel>
        </section>

        <section className="cockpit-grid__side">
          <Panel title={`Movement sync queue (${pendingMovements.length})`}>
            <DataTable
              columns={['Time', 'Action', 'Truck', 'Device', 'Status']}
              rows={pendingMovements.map((item) => [
                formatClientTimestamp(item.clientTs),
                formatOption(item.kind) || '-',
                item.truckId ?? '-',
                item.deviceId ?? '-',
                item.status,
              ])}
              emptyLabel="No queued movement actions on this device."
            />
          </Panel>

          <Panel title="Movement rules">
            <StatusList
              items={[
                { label: 'Incoming conflict', value: 'Fail closed', tone: 'danger' },
                { label: 'Truck swap', value: 'Moves both sides', tone: 'muted' },
                { label: 'Inventory removal', value: 'Source left device-less', tone: 'muted' },
                { label: 'Write path', value: 'Local queue first', tone: 'ok' },
              ]}
            />
          </Panel>
        </section>
      </form>
    </main>
  );
}

function actionNeedsReason(kind: ActionKind): boolean {
  return kind === 'mother_replacement' || kind === 'sub_replacement' || kind === 'removed_to_inventory';
}

function readTruckId(payload: Partial<MovementActionFormValues> | null): string | null {
  if (!payload) return null;
  if ('truckId' in payload && typeof payload.truckId === 'string') return payload.truckId;
  if ('toTruckId' in payload && typeof payload.toTruckId === 'string') return payload.toTruckId;
  return null;
}

function readDeviceId(payload: Partial<MovementActionFormValues> | null): string | null {
  if (!payload) return null;
  if ('motherDeviceId' in payload && typeof payload.motherDeviceId === 'string') return payload.motherDeviceId;
  if ('newMotherDeviceId' in payload && typeof payload.newMotherDeviceId === 'string') return payload.newMotherDeviceId;
  if ('newSubDeviceId' in payload && typeof payload.newSubDeviceId === 'string') return payload.newSubDeviceId;
  if ('deviceId' in payload && typeof payload.deviceId === 'string') return payload.deviceId;
  return null;
}

function formatClientTimestamp(value: number): string {
  if (!value) return '-';
  const date = value > 100000000000 ? new Date(value) : new Date(value * 1000);
  return new Intl.DateTimeFormat(undefined, {
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
