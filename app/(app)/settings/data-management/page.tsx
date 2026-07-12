import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { ArrowLeft, Database, Download, FileJson, FileSpreadsheet } from 'lucide-react';
import { authOptions } from '../../../../lib/auth';
import { sqlite } from '../../../../db';
import { requireSupervisor } from '../../../../services/auth.service';
import { listExportSummaries, type ExportDatasetKey } from '../../../../services/data-management.service';
import { Badge, Panel, StatusList } from '../../_components/ProductUI';

export default async function DataManagementPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/login');
  }

  if (session.user.role !== 'supervisor') {
    redirect('/settings');
  }

  const actor = requireSupervisor({ id: session.user.id, orgId: session.user.orgId, role: session.user.role });
  const exports = listExportSummaries(sqlite, actor);
  const totalRows = exports.reduce((sum, item) => sum + item.rowCount, 0);
  const populatedExports = exports.filter((item) => item.rowCount > 0).length;

  return (
    <main className="settings-cockpit data-management-cockpit">
      <div className="lookup-cockpit__header">
        <div>
          <h1>Data management</h1>
          <p>Export operational records</p>
        </div>
        <Badge tone="ok">Supervisor only</Badge>
      </div>

      <section className="settings-summary" aria-label="Export summary">
        <article className="settings-metric" data-tone="blue">
          <span className="settings-metric__icon" aria-hidden="true"><Database /></span>
          <span><small>Datasets</small><strong>{exports.length}</strong><em>{populatedExports} with data</em></span>
        </article>
        <article className="settings-metric" data-tone="green">
          <span className="settings-metric__icon" aria-hidden="true"><Download /></span>
          <span><small>Formats</small><strong>CSV / JSON</strong><em>Direct download</em></span>
        </article>
      </section>

      <section className="data-management-layout">
        <Panel
          title="Exports"
          action={
            <Link className="btn btn--secondary btn--compact" href="/settings">
              <ArrowLeft aria-hidden="true" />
              Settings
            </Link>
          }
        >
          <div className="export-list" role="list">
              {exports.map((item) => (
                <article className="export-row" key={item.key} role="listitem">
                  <span className="export-card__icon" aria-hidden="true">
                    {exportIcon(item.key)}
                  </span>
                  <div className="export-card__body">
                    <strong>{item.label}</strong>
                    <span>{item.rowCount.toLocaleString()} rows</span>
                  </div>
                  <div className="export-card__actions">
                    <a className="btn btn--secondary btn--compact" href={`/api/settings/exports?dataset=${item.key}&format=csv`}>
                      <FileSpreadsheet aria-hidden="true" />
                      CSV
                    </a>
                    <a className="btn btn--secondary btn--compact" href={`/api/settings/exports?dataset=${item.key}&format=json`}>
                      <FileJson aria-hidden="true" />
                      JSON
                    </a>
                  </div>
                </article>
              ))}
          </div>
        </Panel>

        <aside className="data-management-layout__side">
          <Panel title="Export scope">
            <StatusList
              items={[
                { label: 'Organisation', value: 'Current session org', tone: 'ok' },
                { label: 'Password hashes', value: 'Excluded', tone: 'ok' },
                { label: 'Formats', value: 'CSV / JSON', tone: 'muted' },
                { label: 'Total rows', value: String(totalRows), tone: totalRows > 0 ? 'ok' : 'muted' },
              ]}
            />
          </Panel>
        </aside>
      </section>
    </main>
  );
}

function exportIcon(key: ExportDatasetKey) {
  if (key.includes('log') || key === 'audit_log') return <FileSpreadsheet />;
  if (key.includes('review') || key.includes('sync')) return <FileJson />;
  return <Database />;
}
