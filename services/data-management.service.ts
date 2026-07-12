import type { Database } from 'better-sqlite3';
import { AuthzError } from '../lib/errors';
import type { AuthenticatedUser } from './auth.service';
import { requireSupervisor } from './auth.service';

export type ExportFormat = 'csv' | 'json';

export type ExportDatasetKey =
  | 'users'
  | 'trucks'
  | 'devices'
  | 'registration_logs'
  | 'kit_members'
  | 'truck_assignments'
  | 'slot_pairings'
  | 'installation_logs'
  | 'fault_reports'
  | 'movement_logs'
  | 'verifications'
  | 'conflict_reviews'
  | 'audit_log'
  | 'sync_mutations';

type ExportDataset = {
  key: ExportDatasetKey;
  label: string;
  table: string;
  orgScoped: boolean;
  columns?: string[];
};

export const EXPORT_DATASETS: ExportDataset[] = [
  {
    key: 'users',
    label: 'Users',
    table: 'users',
    orgScoped: true,
    columns: ['id', 'org_id', 'username', 'display_name', 'role', 'company', 'is_active', 'last_login', 'created_at', 'updated_at'],
  },
  { key: 'trucks', label: 'Trucks', table: 'trucks', orgScoped: true },
  { key: 'devices', label: 'Devices', table: 'devices', orgScoped: true },
  { key: 'registration_logs', label: 'Registration logs', table: 'registration_logs', orgScoped: true },
  { key: 'kit_members', label: 'Kit members', table: 'kit_members', orgScoped: true },
  { key: 'truck_assignments', label: 'Truck assignments', table: 'truck_assignments', orgScoped: true },
  { key: 'slot_pairings', label: 'Slot pairings', table: 'slot_pairings', orgScoped: true },
  { key: 'installation_logs', label: 'Installation logs', table: 'installation_logs', orgScoped: true },
  { key: 'fault_reports', label: 'Fault reports', table: 'fault_reports', orgScoped: true },
  { key: 'movement_logs', label: 'Movement logs', table: 'movement_logs', orgScoped: true },
  { key: 'verifications', label: 'Verifications', table: 'verifications', orgScoped: true },
  { key: 'conflict_reviews', label: 'Conflict reviews', table: 'conflict_reviews', orgScoped: true },
  { key: 'audit_log', label: 'Audit log', table: 'audit_log', orgScoped: true },
  { key: 'sync_mutations', label: 'Sync mutations', table: 'sync_mutations', orgScoped: true },
];

export type ExportSummary = {
  key: ExportDatasetKey;
  label: string;
  rowCount: number;
};

export function listExportSummaries(sqlite: Database, actor: AuthenticatedUser): ExportSummary[] {
  const supervisor = requireSupervisor(actor);

  return EXPORT_DATASETS.map((dataset) => ({
    key: dataset.key,
    label: dataset.label,
    rowCount: countRows(sqlite, dataset, supervisor.orgId),
  }));
}

export function buildExport(sqlite: Database, actor: AuthenticatedUser, input: { dataset: string; format: string }) {
  const supervisor = requireSupervisor(actor);
  const dataset = EXPORT_DATASETS.find((entry) => entry.key === input.dataset);
  const format: ExportFormat = input.format === 'json' ? 'json' : 'csv';

  if (!dataset) {
    throw new AuthzError('Unknown export dataset.');
  }

  const rows = readRows(sqlite, dataset, supervisor.orgId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `dtc-${dataset.key}-${timestamp}.${format}`;
  const body = format === 'json' ? JSON.stringify(rows, null, 2) : toCsv(rows);
  const contentType = format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8';

  return { body, contentType, filename };
}

function countRows(sqlite: Database, dataset: ExportDataset, orgId: string): number {
  const sql = dataset.orgScoped
    ? `select count(*) as count from ${dataset.table} where org_id = ?`
    : `select count(*) as count from ${dataset.table}`;
  const row = dataset.orgScoped ? sqlite.prepare(sql).get(orgId) : sqlite.prepare(sql).get();
  return Number((row as { count?: number } | undefined)?.count ?? 0);
}

function readRows(sqlite: Database, dataset: ExportDataset, orgId: string): Array<Record<string, unknown>> {
  const columns = dataset.columns?.join(', ') ?? '*';
  const sql = dataset.orgScoped
    ? `select ${columns} from ${dataset.table} where org_id = ? order by rowid desc`
    : `select ${columns} from ${dataset.table} order by rowid desc`;
  return (dataset.orgScoped ? sqlite.prepare(sql).all(orgId) : sqlite.prepare(sql).all()) as Array<Record<string, unknown>>;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]);
  const header = columns.map(csvCell).join(',');
  const body = rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}
