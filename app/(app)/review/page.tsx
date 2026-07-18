'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  DataTable,
  IndustrialPageHeader,
  Panel,
  StatusList,
  TrustBanner,
  formatTimestamp,
} from '../_components/ProductUI';
import { fetchOpenReviews, submitReviewAction, type ConflictReviewListItem } from './actions';

type ReviewActionState = { status: 'idle' } | { status: 'working'; reviewId: string } | { status: 'error'; message: string };

export default function ReviewPage() {
  const [reviews, setReviews] = useState<ConflictReviewListItem[]>([]);
  const [notesByReview, setNotesByReview] = useState<Record<string, string>>({});
  const [state, setState] = useState<ReviewActionState>({ status: 'idle' });
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const rows = await fetchOpenReviews();
      setReviews(rows);
    } catch {
      setReviews([]);
      setState({ status: 'error', message: 'Could not load open reviews' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function handleAction(reviewId: string, action: 'resolve' | 'dismiss') {
    setState({ status: 'working', reviewId });
    const result = await submitReviewAction(reviewId, action, notesByReview[reviewId]);
    if (result.status === 'error') {
      setState({ status: 'error', message: result.message });
      return;
    }
    setNotesByReview((current) => {
      const next = { ...current };
      delete next[reviewId];
      return next;
    });
    setState({ status: 'idle' });
    await reload();
  }

  const registryReviews = reviews.filter((review) => review.kind !== 'sync_conflict');
  const syncReviews = reviews.filter((review) => review.kind === 'sync_conflict');
  const importReviews = reviews.filter((review) => review.kind === 'import_conflict');

  const statusItems = useMemo(
    () => [
      { label: 'Open reviews', value: String(reviews.length), tone: reviews.length ? ('danger' as const) : ('ok' as const) },
      {
        label: 'Registry corrections',
        value: String(registryReviews.length),
        tone: registryReviews.length ? ('danger' as const) : ('muted' as const),
      },
      {
        label: 'Sync conflicts',
        value: String(syncReviews.length),
        tone: syncReviews.length ? ('danger' as const) : ('muted' as const),
      },
      {
        label: 'Import conflicts',
        value: String(importReviews.length),
        tone: importReviews.length ? ('danger' as const) : ('muted' as const),
      },
      {
        label: 'Action mode',
        value: 'REVIEW DECISION',
        tone: 'muted' as const,
      },
    ],
    [importReviews.length, registryReviews.length, reviews.length, syncReviews.length],
  );

  return (
    <main className="review-console">
      <IndustrialPageHeader
        eyebrow="Evidence and decision control"
        title="Review"
        accent={String(reviews.length).padStart(2, '0')}
        metric={loading ? '--' : `${reviews.length}!`}
        description="Every review exposes source data, conflicting state, operational impact and resolution route."
        status={<Badge tone={reviews.length > 0 ? 'danger' : loading ? 'warning' : 'ok'}>{loading ? 'Loading' : `${reviews.length} open`}</Badge>}
      />

      <TrustBanner
        empty={reviews.length === 0}
        emptyTitle={loading ? 'Loading reviews' : 'No open conflict reviews'}
        emptyBody={
          loading
            ? 'Open reviews are loading from the server.'
            : 'There are no supervisor acknowledgements waiting right now.'
        }
        state="unverified"
        latestVerifiedAt={null}
        weakestTier={null}
      />

      {state.status === 'error' && (
        <p className="banner banner--error" role="alert">
          {`Error: ${state.message}`}
        </p>
      )}

      <div className="cockpit-grid">
        <section className="cockpit-grid__primary">
          <Panel title={`Registry corrections (${registryReviews.length})`}>
            <div className="review-stack">
              {registryReviews.length === 0 && <p className="empty-state">No open registry correction reviews.</p>}
              {registryReviews.map((review) => (
                <SupervisorReviewCard
                  key={review.id}
                  review={review}
                  notes={notesByReview[review.id] ?? ''}
                  working={state.status === 'working' && state.reviewId === review.id}
                  onNotes={(value) => setNotesByReview((current) => ({ ...current, [review.id]: value }))}
                  onAction={handleAction}
                />
              ))}
            </div>
          </Panel>
        </section>

        <section className="cockpit-grid__middle">
          <Panel title="Review status">
            <StatusList items={statusItems} />
          </Panel>

          <Panel title={`Sync conflicts (${syncReviews.length})`}>
            <div className="review-stack">
              {syncReviews.length === 0 && <p className="empty-state">No open sync conflicts.</p>}
              {syncReviews.map((review) => (
                <SupervisorReviewCard
                  key={review.id}
                  review={review}
                  notes={notesByReview[review.id] ?? ''}
                  working={state.status === 'working' && state.reviewId === review.id}
                  onNotes={(value) => setNotesByReview((current) => ({ ...current, [review.id]: value }))}
                  onAction={handleAction}
                />
              ))}
            </div>
          </Panel>
        </section>

        <section className="cockpit-grid__side">
          <Panel title="Open review table" className="table-workbench">
            <DataTable
              columns={['Created', 'Kind', 'Status']}
              rows={reviews.map((review) => [formatTimestamp(review.createdAt), formatKind(review.kind), review.status])}
              emptyLabel="No open reviews."
            />
          </Panel>

          <Panel title="Review rules">
            <StatusList
              items={[
                { label: 'Resolve', value: 'Reviewed and accepted', tone: 'ok' },
                { label: 'Dismiss', value: 'Reviewed, no action needed', tone: 'muted' },
                { label: 'Registry edits', value: 'Use register/install/movement flows', tone: 'danger' },
                { label: 'Audit', value: 'Transition logged', tone: 'ok' },
              ]}
            />
          </Panel>
        </section>
      </div>
    </main>
  );
}

function SupervisorReviewCard({
  review,
  notes,
  working,
  onNotes,
  onAction,
}: {
  review: ConflictReviewListItem;
  notes: string;
  working: boolean;
  onNotes: (value: string) => void;
  onAction: (reviewId: string, action: 'resolve' | 'dismiss') => void;
}) {
  return (
    <article className="supervisor-review-card">
      <header>
        <div>
          <Badge tone={review.kind === 'sync_conflict' ? 'warning' : 'danger'}>{formatKind(review.kind)}</Badge>
          <strong>{primaryLine(review)}</strong>
        </div>
        <span>{formatTimestamp(review.createdAt)}</span>
      </header>

      <PayloadSummary review={review} />

      <label>
        <span>Resolution notes</span>
        <textarea value={notes} onChange={(event) => onNotes(event.target.value)} placeholder="Decision notes, correction reference, or reason for dismissal" />
      </label>

      <div className="list-item__actions">
        <button className="btn btn--primary" type="button" disabled={working} onClick={() => onAction(review.id, 'resolve')}>
          Resolve
        </button>
        <button className="btn btn--secondary" type="button" disabled={working} onClick={() => onAction(review.id, 'dismiss')}>
          Dismiss
        </button>
      </div>
    </article>
  );
}

function PayloadSummary({ review }: { review: ConflictReviewListItem }) {
  const payload = review.payload;

  if (review.kind === 'unlogged_swap') {
    return (
      <dl className="payload-grid">
        <PayloadRow label="Truck" value={truckDisplayValue(payload.truckLabel, payload.truckId)} />
        <PayloadRow label="Expected mother" value={payload.expectedMotherSerial ?? '(none recorded)'} />
        <PayloadRow label="Observed mother" value={payload.observedMotherSerial} />
        <PayloadRow label="Expected subs" value={arrayValue(payload.expectedSubSerials)} />
        <PayloadRow label="Observed subs" value={arrayValue(payload.observedSubSerials)} />
      </dl>
    );
  }

  if (review.kind === 'sync_conflict') {
    const queuedMutation = payload.queuedMutation as
      | { id: string; endpoint: string; payload: unknown; clientTs: number; seq: number }
      | undefined;

    return (
      <dl className="payload-grid">
        <PayloadRow label="Queued mutation" value={queuedMutation ? `${queuedMutation.endpoint} - ${JSON.stringify(queuedMutation.payload)}` : '(unavailable)'} />
        <PayloadRow label="Current server state" value={JSON.stringify(payload.currentServerState ?? {})} />
        <PayloadRow label="Reason" value={payload.error} />
      </dl>
    );
  }

  if (review.kind === 'import_conflict') {
    return <ImportConflictSummary payload={payload} />;
  }

  return (
    <dl className="payload-grid">
      {Object.entries(payload).map(([key, value]) => (
        <PayloadRow key={key} label={key} value={typeof value === 'object' ? JSON.stringify(value) : value} />
      ))}
    </dl>
  );
}

function ImportConflictSummary({ payload }: { payload: Record<string, unknown> }) {
  const reason = stringValue(payload.reason);
  const source = stringValue(payload.source);
  const row = objectValue(payload.row);
  const duplicatedSubs = arrayValue(payload.duplicated_subs);

  if (reason === 'kit_mismatch_updated_registry') {
    return (
      <div className="review-detail">
        <dl className="payload-grid">
          <PayloadRow label="Issue" value="Installation kit does not match Updated Registry for this mother/truck." />
          <PayloadRow label="Source" value={source} />
          <PayloadRow label="Truck" value={stringValue(row.truck)} />
          <PayloadRow label="Mother" value={stringValue(row.mother)} />
          <PayloadRow label="Install row" value={stringValue(row.install_row)} />
          <PayloadRow label="Registry row" value={stringValue(row.registry_row)} />
        </dl>
        <table className="review-evidence-table">
          <thead>
            <tr>
              <th>Slot</th>
              <th>Installation sheet</th>
              <th>Updated Registry</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {(['b', 'c', 'd'] as const).map((slot) => {
              const install = stringValue(row[`install_sub_${slot}`]);
              const registry = stringValue(row[`registry_sub_${slot}`]);
              const match = install !== '' && install === registry;
              return (
                <tr key={slot} data-tone={match ? 'ok' : 'danger'}>
                  <td>{slot.toUpperCase()}</td>
                  <td>{install || 'Missing'}</td>
                  <td>{registry || 'Missing'}</td>
                  <td>{match ? 'Match' : 'Mismatch'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (reason === 'invalid_masterlist_kit') {
    const invalidReasons = invalidMasterlistReasons(row);
    return (
      <div className="review-detail">
        <dl className="payload-grid">
          <PayloadRow label="Issue" value={invalidReasons.join('; ')} />
          <PayloadRow label="Source" value={source} />
          <PayloadRow label="Masterlist row" value={stringValue(row.source_row)} />
          <PayloadRow label="Mother" value={stringValue(row.mother)} />
          <PayloadRow label="SIM" value={stringValue(row.sim)} />
          <PayloadRow label="Date" value={stringValue(row.date)} />
          <PayloadRow label="Sub B" value={stringValue(row.sub_b) || 'Missing'} />
          <PayloadRow label="Sub C" value={stringValue(row.sub_c) || 'Missing'} />
          <PayloadRow label="Sub D" value={stringValue(row.sub_d) || 'Missing'} />
        </dl>
      </div>
    );
  }

  if (reason === 'masterlist_sub_in_multiple_kits') {
    return (
      <div className="review-detail">
        <dl className="payload-grid">
          <PayloadRow label="Issue" value="One or more sub-lock serials are registered in more than one masterlist kit." />
          <PayloadRow label="Duplicated sub-locks" value={duplicatedSubs} />
          <PayloadRow label="Source" value={source} />
          <PayloadRow label="Masterlist row" value={stringValue(row.source_row)} />
          <PayloadRow label="Mother" value={stringValue(row.mother)} />
          <PayloadRow label="SIM" value={stringValue(row.sim)} />
          <PayloadRow label="Sub B" value={stringValue(row.sub_b)} />
          <PayloadRow label="Sub C" value={stringValue(row.sub_c)} />
          <PayloadRow label="Sub D" value={stringValue(row.sub_d)} />
        </dl>
      </div>
    );
  }

  if (reason === 'mother_missing_registration_masterlist') {
    return (
      <div className="review-detail">
        <dl className="payload-grid">
          <PayloadRow label="Issue" value="Latest installation uses a mother that is still missing from Registration Masterlist. This stayed open because at least one sub-lock is already registered to another mother." />
          <PayloadRow label="Source" value={source} />
          <PayloadRow label="Install row" value={stringValue(row.source_row)} />
          <PayloadRow label="Submitted" value={stringValue(row.submitted_at)} />
          <PayloadRow label="Team member" value={stringValue(row.team_member)} />
          <PayloadRow label="Truck" value={stringValue(row.truck)} />
          <PayloadRow label="Mother" value={stringValue(row.mother)} />
          <PayloadRow label="Sub B" value={stringValue(row.sub_b)} />
          <PayloadRow label="Sub C" value={stringValue(row.sub_c)} />
          <PayloadRow label="Sub D" value={stringValue(row.sub_d)} />
        </dl>
      </div>
    );
  }

  return (
    <dl className="payload-grid">
      <PayloadRow label="Issue" value={reason ? reason.replaceAll('_', ' ') : 'Import conflict'} />
      <PayloadRow label="Source" value={source} />
      {Object.entries(row).map(([key, value]) => (
        <PayloadRow key={key} label={key.replaceAll('_', ' ')} value={typeof value === 'object' ? JSON.stringify(value) : value} />
      ))}
    </dl>
  );
}

function PayloadRow({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === '') return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{String(value)}</dd>
    </div>
  );
}

function arrayValue(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') || '(none)' : '';
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function invalidMasterlistReasons(row: Record<string, unknown>): string[] {
  const subs = ['sub_b', 'sub_c', 'sub_d'].map((key) => stringValue(row[key]).trim()).filter(Boolean);
  const reasons: string[] = [];
  if (subs.length === 0) reasons.push('Mother-only registration; no sub-locks listed');
  else if (subs.length < 3) reasons.push(`Registration has ${subs.length} sub-lock${subs.length === 1 ? '' : 's'} listed; expected 3 for a complete kit`);
  if (new Set(subs).size !== subs.length) reasons.push('Same sub-lock appears more than once in this kit');
  return reasons.length ? reasons : ['Registration row needs review'];
}

function primaryLine(review: ConflictReviewListItem): string {
  const payload = review.payload;
  if (review.kind === 'sync_conflict') {
    const queuedMutation = payload.queuedMutation as { endpoint?: string } | undefined;
    return queuedMutation?.endpoint ?? 'Sync conflict';
  }
  if (typeof payload.truckId === 'string' || typeof payload.truckLabel === 'string') return truckDisplayValue(payload.truckLabel, payload.truckId);
  if (typeof payload.observedMotherSerial === 'string') return payload.observedMotherSerial;
  if (review.kind === 'import_conflict') {
    const reason = importReasonTitle(stringValue(payload.reason));
    const row = objectValue(payload.row);
    const truck = stringValue(row.truck);
    const mother = stringValue(row.mother);
    return [reason || 'Import conflict', truck || mother].filter(Boolean).join(' - ');
  }
  return 'Review details';
}

function truckDisplayValue(label: unknown, id: unknown): string {
  if (typeof label === 'string' && label.trim()) return label;
  if (typeof id !== 'string' || !id.trim()) return '';
  return id.startsWith('trk_') ? 'Truck' : id;
}

function formatKind(kind: string): string {
  return kind.replaceAll('_', ' ');
}

function importReasonTitle(reason: string): string {
  if (reason === 'invalid_masterlist_kit') return 'Registration issue';
  if (reason === 'kit_mismatch_updated_registry') return 'Kit mismatch';
  if (reason === 'masterlist_sub_in_multiple_kits') return 'Duplicate sub-lock registration';
  if (reason === 'mother_missing_registration_masterlist') return 'Missing masterlist registration';
  return reason.replaceAll('_', ' ');
}
