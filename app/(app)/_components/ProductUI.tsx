'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ClipboardCheck,
  Keyboard,
  ListChecks,
  PackagePlus,
  QrCode,
  Search,
  ShieldCheck,
  Truck,
  Wrench,
} from 'lucide-react';
import { CameraScanner } from '../../../lib/qr/scanner';

type PanelProps = {
  id?: string;
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

export function IndustrialPageHeader({
  eyebrow,
  title,
  accent,
  metric,
  description,
  status,
}: {
  eyebrow: string;
  title: string;
  accent?: string;
  metric: React.ReactNode;
  description: string;
  status?: React.ReactNode;
}) {
  return (
    <header className="industrial-page-head">
      <div className="industrial-page-head__title">
        <span>[ {eyebrow} ]</span>
        <h1>{title}{accent && <><br /><em>{accent}</em></>}</h1>
      </div>
      <div className="industrial-page-head__brief">
        <strong>{metric}</strong>
        <p>{description}</p>
        {status && <div className="industrial-page-head__status">{status}</div>}
      </div>
    </header>
  );
}

export function Panel({ id, title, action, className, children }: PanelProps) {
  return (
    <section id={id} className={['panel', className].filter(Boolean).join(' ')}>
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
  required,
}: {
  label: string;
  prefix: string;
  value: string;
  placeholder: string;
  onChange: (value: string, source?: 'qr_scan' | 'manual') => void;
  required?: boolean;
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
      onChange(normalized, 'qr_scan');
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
          <input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            required={required}
            onChange={(event) => onChange(event.target.value, 'manual')}
          />
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
  pagination,
}: {
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
  emptyLabel: string;
  pageSize?: number;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    disabled?: boolean;
  };
}) {
  const [localPage, setLocalPage] = useState(0);
  const controlled = Boolean(pagination);
  const activePage = pagination?.page ?? localPage;
  const activePageSize = pagination?.pageSize ?? pageSize;
  const totalRows = pagination?.total ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / activePageSize));
  const visibleRows = useMemo(
    () => controlled ? rows : rows.slice(activePage * activePageSize, activePage * activePageSize + activePageSize),
    [activePage, activePageSize, controlled, rows],
  );

  useEffect(() => {
    if (!controlled) setLocalPage(0);
  }, [controlled, rows.length, pageSize]);

  function changePage(page: number) {
    const nextPage = Math.min(pageCount - 1, Math.max(0, page));
    if (pagination) {
      pagination.onPageChange(nextPage);
    } else {
      setLocalPage(nextPage);
    }
  }

  if (rows.length === 0) {
    return <p className="empty-state">{emptyLabel}</p>;
  }

  return (
    <div className="data-table-shell">
      <div className="data-table-wrap">
        <table className="data-table" data-columns={columns.length}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={activePage * activePageSize + rowIndex}>
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
            {activePage * activePageSize + 1}-{Math.min(totalRows, (activePage + 1) * activePageSize)} of {totalRows}
          </span>
          <div>
            <button type="button" className="btn btn--secondary btn--compact" onClick={() => changePage(activePage - 1)} disabled={activePage === 0 || pagination?.disabled}>
              Prev
            </button>
            <button type="button" className="btn btn--secondary btn--compact" onClick={() => changePage(activePage + 1)} disabled={activePage === pageCount - 1 || pagination?.disabled}>
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
  return new Intl.DateTimeFormat("en-GB", {
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
  const truckLabel = typeof data.truckLabel === 'string' ? data.truckLabel : null;
  const truckDisplay = truckLabel ?? (truckId?.startsWith('trk_') ? 'Truck' : truckId);

  if (truckDisplay && observed) return `${truckDisplay} observed ${observed}`;
  if (expected && observed) return `${expected} -> ${observed}`;
  if (error) return error;
  return 'Review details available';
}

function ButtonIcon({ name }: { name: 'scan' | 'manual' }) {
  const Icon = name === 'scan' ? QrCode : Keyboard;
  return <Icon className="btn__icon" strokeWidth={1.9} aria-hidden="true" />;
}

function ActionIcon({ label }: { label: string }) {
  const icons = {
    register: PackagePlus,
    install: Wrench,
    fault: AlertTriangle,
    movement: Truck,
    lookup: Search,
    verify: ShieldCheck,
    review: ClipboardCheck,
    triage: ListChecks,
  } as const;
  const Icon = icons[label.toLowerCase() as keyof typeof icons] ?? ListChecks;
  return <Icon className="action-tile__icon" strokeWidth={1.9} aria-hidden="true" />;
}
