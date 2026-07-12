'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CameraScanner } from '../../../lib/qr/scanner';

type PanelProps = {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

export function Panel({ title, action, className, children }: PanelProps) {
  return (
    <section className={['panel', className].filter(Boolean).join(' ')}>
      {(title || action) && (
        <header className="panel__header">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      <div className="panel__body">{children}</div>
    </section>
  );
}

export function TrustBanner({
  state,
  latestVerifiedAt,
  weakestTier,
  empty,
  emptyTitle,
  emptyBody,
}: {
  state: 'verified' | 'stale' | 'unverified';
  latestVerifiedAt: number | null;
  weakestTier: 'qr_scan' | 'photo_attestation' | 'manual' | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (empty) {
    return (
      <div className="trust-banner trust-banner--empty" data-testid="trust-banner" data-trust-state="empty">
        <div className="trust-banner__icon" aria-hidden="true">
          !
        </div>
        <div>
          <strong>{emptyTitle ?? 'No target selected'}</strong>
          <span>{emptyBody ?? 'Search by truck, plate, mother serial, or device ID.'}</span>
        </div>
      </div>
    );
  }

  if (state === 'verified') {
    return (
      <div className="trust-banner trust-banner--verified" role="status" data-testid="trust-banner" data-trust-state="verified">
        <div className="trust-banner__icon" aria-hidden="true">
          OK
        </div>
        <div>
          <strong>CONFIRMED</strong>
          <span>{latestVerifiedAt ? `Verified ${formatAge(latestVerifiedAt)} via ${formatTier(weakestTier)}` : 'Verified'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="trust-banner trust-banner--danger" role="alert" data-testid="trust-banner" data-trust-state={state}>
      <div className="trust-banner__icon" aria-hidden="true">
        !
      </div>
      <div>
        <strong>NOT CONFIRMED</strong>
        <span>{state === 'stale' && latestVerifiedAt ? `Last verified ${formatAge(latestVerifiedAt)}. Verify before use.` : 'Verify before use.'}</span>
      </div>
    </div>
  );
}

export function ScanInputRow({
  label,
  prefix,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  prefix: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const clearTimerRef = useRef<number | null>(null);
  const [mode, setMode] = useState<'idle' | 'scan' | 'manual'>('idle');
  const [scannerOpen, setScannerOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  function setTemporaryMode(nextMode: 'scan' | 'manual') {
    setMode(nextMode);

    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
    }
    clearTimerRef.current = window.setTimeout(() => setMode('idle'), 2400);
  }

  function activateManual() {
    setScannerOpen(false);
    setTemporaryMode('manual');
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  function activateScan() {
    setTemporaryMode('scan');
    setScannerOpen(true);
  }

  function handleDetected(rawValue: string) {
    const normalized = rawValue.trim();
    if (normalized) {
      onChange(normalized);
    }
    setScannerOpen(false);
    setTemporaryMode('scan');
    inputRef.current?.focus();
  }

  return (
    <div className="scan-input-row" data-mode={mode}>
      <label>
        <span>{label}</span>
        <span className="scan-input-row__control">
          <span className="scan-input-row__prefix">{prefix}</span>
          <input ref={inputRef} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        </span>
      </label>
      <button
        type="button"
        className="btn btn--primary btn--compact"
        aria-pressed={mode === 'scan'}
        onClick={activateScan}
      >
        <ButtonIcon name="scan" />
        Scan
      </button>
      <button
        type="button"
        className="btn btn--secondary btn--compact"
        aria-pressed={mode === 'manual'}
        onClick={activateManual}
      >
        <ButtonIcon name="manual" />
        Manual entry
      </button>
      <span className="scan-input-row__hint" aria-live="polite">
        {scannerOpen ? 'Camera scanner active' : mode === 'scan' ? 'Ready for camera or scanner input' : mode === 'manual' ? 'Manual entry active' : ''}
      </span>
      <CameraScanner
        open={scannerOpen}
        label={label}
        onCancel={() => {
          setScannerOpen(false);
          setMode('idle');
        }}
        onDetected={handleDetected}
      />
    </div>
  );
}

export function StatusList({ items }: { items: Array<{ label: string; value: React.ReactNode; tone?: 'danger' | 'ok' | 'muted' }> }) {
  return (
    <dl className="status-list">
      {items.map((item) => (
        <div className="status-list__row" key={item.label}>
          <dt>{item.label}</dt>
          <dd data-tone={item.tone ?? 'muted'}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ReviewCard({
  kind,
  createdAt,
  payload,
}: {
  kind: 'sync_conflict' | 'unlogged_swap' | 'import_conflict';
  createdAt: number;
  payload: unknown;
}) {
  return (
    <article className="review-card">
      <span className="badge badge--danger">{formatKind(kind)}</span>
      <strong>{primaryPayloadLine(payload)}</strong>
      <span>{formatTimestamp(createdAt)}</span>
    </article>
  );
}

export function DataTable({
  columns,
  rows,
  emptyLabel,
  pageSize = 8,
}: {
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
  emptyLabel: string;
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = useMemo(() => rows.slice(page * pageSize, page * pageSize + pageSize), [page, pageSize, rows]);

  useEffect(() => {
    setPage(0);
  }, [rows.length, pageSize]);

  if (rows.length === 0) {
    return <p className="empty-state">{emptyLabel}</p>;
  }

  return (
    <div className="data-table-shell">
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={page * pageSize + rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} data-label={columns[cellIndex]}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div className="data-table-pagination" aria-label="Table pagination">
          <span>
            {page * pageSize + 1}-{Math.min(rows.length, (page + 1) * pageSize)} of {rows.length}
          </span>
          <div>
            <button type="button" className="btn btn--secondary btn--compact" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>
              Prev
            </button>
            <button type="button" className="btn btn--secondary btn--compact" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page === pageCount - 1}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ActionTile({ href, label, detail }: { href: string; label: string; detail: string }) {
  return (
    <Link className="action-tile" href={href}>
      <ActionIcon label={label} />
      <strong>{label}</strong>
      <span className="action-tile__detail">{detail}</span>
    </Link>
  );
}

export function Badge({ children, tone }: { children: React.ReactNode; tone: 'ok' | 'warning' | 'danger' | 'muted' }) {
  return (
    <span className="badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function formatTimestamp(unixSeconds: number | null): string {
  if (!unixSeconds) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(unixSeconds * 1000));
}

function formatAge(unixSeconds: number): string {
  const days = Math.floor((Date.now() / 1000 - unixSeconds) / 86400);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function formatTier(tier: 'qr_scan' | 'photo_attestation' | 'manual' | null): string {
  if (!tier) return 'unknown source';
  return tier.replaceAll('_', ' ');
}

function formatKind(kind: 'sync_conflict' | 'unlogged_swap' | 'import_conflict'): string {
  return kind.replaceAll('_', ' ');
}

function primaryPayloadLine(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'Review details available';
  const data = payload as Record<string, unknown>;
  const truckId = typeof data.truckId === 'string' ? data.truckId : null;
  const observed = typeof data.observedMotherSerial === 'string' ? data.observedMotherSerial : null;
  const expected = typeof data.expectedMotherSerial === 'string' ? data.expectedMotherSerial : null;
  const error = typeof data.error === 'string' ? data.error : null;

  if (truckId && observed) return `${truckId} observed ${observed}`;
  if (expected && observed) return `${expected} -> ${observed}`;
  if (error) return error;
  return 'Review details available';
}

function ButtonIcon({ name }: { name: 'scan' | 'manual' }) {
  return (
    <svg className="btn__icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === 'scan' ? (
        <>
          <path d="M5 8V5h3M16 5h3v3M19 16v3h-3M8 19H5v-3" />
          <path d="M9 9h2v2H9zM13 9h2v2h-2zM9 13h2v2H9zM14 14h1v1h-1z" />
        </>
      ) : (
        <>
          <path d="M5 7h14v10H5z" />
          <path d="M8 10h8M8 14h5" />
        </>
      )}
    </svg>
  );
}

function ActionIcon({ label }: { label: string }) {
  const key = label.toLowerCase();
  return (
    <svg className="action-tile__icon" viewBox="0 0 24 24" aria-hidden="true">
      {key === 'register' && (
        <>
          <path d="M8 4h8l2 2v14H6V6z" />
          <path d="M9 10h6M9 14h4M17 12h4M19 10v4" />
        </>
      )}
      {key === 'install' && <path d="m14 4 6 6-4 4-2-2-6 6-4-4 6-6-2-2z" />}
      {key === 'fault' && (
        <>
          <path d="M12 4 21 20H3z" />
          <path d="M12 9v5M12 17h.01" />
        </>
      )}
      {key === 'movement' && (
        <>
          <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
          <path d="M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
        </>
      )}
      {key === 'lookup' && (
        <>
          <circle cx="11" cy="11" r="6" />
          <path d="m16 16 5 5" />
        </>
      )}
      {key === 'verify' && (
        <>
          <path d="M12 3 20 7v6c0 4-3 7-8 8-5-1-8-4-8-8V7z" />
          <path d="m9 12 2 2 4-4" />
        </>
      )}
      {key === 'review' && (
        <>
          <path d="M7 4h10v16H7z" />
          <path d="M9 9h6M9 13h6" />
        </>
      )}
      {key === 'triage' && <path d="M12 3 20 7v6c0 4-3 7-8 8-5-1-8-4-8-8V7z" />}
    </svg>
  );
}
