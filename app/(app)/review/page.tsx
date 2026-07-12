'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  DataTable,
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
        value: 'ACKNOWLEDGE ONLY',
        tone: 'danger' as const,
      },
    ],
    [importReviews.length, registryReviews.length, reviews.length, syncReviews.length],
  );

  return (
    <main className="review-console">
      <div className="lookup-cockpit__header">
        <div>
          <h1>Review</h1>
          <p>Supervisor conflict console</p>
        </div>
        <Badge tone={reviews.length > 0 ? 'danger' : loading ? 'warning' : 'ok'}>
          {loading ? 'Loading' : `${reviews.length} open`}
        </Badge>
      </div>

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
          <Panel title="Open review table">
            <DataTable
              columns={['Created', 'Kind', 'Status']}
              rows={reviews.map((review) => [formatTimestamp(review.createdAt), formatKind(review.kind), review.status])}
              emptyLabel="No open reviews."
            />
          </Panel>

          <Panel title="Review rules">
            <StatusList
              items={[
                { label: 'Resolve', value: 'Acknowledge accepted', tone: 'muted' },
                { label: 'Dismiss', value: 'Acknowledge no action', tone: 'muted' },
                { label: 'Registry edits', value: 'Not performed here', tone: 'danger' },
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
        <textarea value={notes} onChange={(event) => onNotes(event.target.value)} placeholder="Optional acknowledgement notes" />
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
        <PayloadRow label="Truck" value={payload.truckId} />
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

  return (
    <dl className="payload-grid">
      {Object.entries(payload).map(([key, value]) => (
        <PayloadRow key={key} label={key} value={typeof value === 'object' ? JSON.stringify(value) : value} />
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

function primaryLine(review: ConflictReviewListItem): string {
  const payload = review.payload;
  if (review.kind === 'sync_conflict') {
    const queuedMutation = payload.queuedMutation as { endpoint?: string } | undefined;
    return queuedMutation?.endpoint ?? 'Sync conflict';
  }
  if (typeof payload.truckId === 'string') return payload.truckId;
  if (typeof payload.observedMotherSerial === 'string') return payload.observedMotherSerial;
  return 'Review details';
}

function formatKind(kind: string): string {
  return kind.replaceAll('_', ' ');
}
