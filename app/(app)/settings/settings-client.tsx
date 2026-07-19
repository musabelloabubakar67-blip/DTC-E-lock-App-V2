'use client';

import { useFormState } from 'react-dom';
import { signOut } from 'next-auth/react';
import { useState, type ReactNode } from 'react';
import { Database, FileJson, FileSpreadsheet, LogOut, Palette, UserPlus, Users, X } from 'lucide-react';
import { Badge, DataTable, IndustrialPageHeader, Panel } from '../_components/ProductUI';
import type { ExportSummary } from '../../../services/data-management.service';
import type { SettingsData } from '../../../services/settings.service';
import type { SettingsActionState } from './actions';

type Props = {
  settings: SettingsData;
  currentUserId: string;
  currentRole: 'installer' | 'supervisor';
  initialActionState: SettingsActionState;
  exportSummaries: ExportSummary[];
  changePasswordAction: (state: SettingsActionState, formData: FormData) => Promise<SettingsActionState>;
  createUserAction: (state: SettingsActionState, formData: FormData) => Promise<SettingsActionState>;
  setUserActiveAction: (formData: FormData) => Promise<void>;
  setAppearanceAction: (formData: FormData) => Promise<void>;
};

export default function SettingsClient({
  settings,
  currentUserId,
  currentRole,
  initialActionState,
  exportSummaries,
  changePasswordAction,
  createUserAction,
  setUserActiveAction,
  setAppearanceAction,
}: Props) {
  const [createState, createFormAction] = useFormState(createUserAction, initialActionState);
  const [passwordState, passwordFormAction] = useFormState(changePasswordAction, initialActionState);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const activeUsers = settings.users.filter((user) => user.isActive).length;
  const canManageUsers = currentRole === 'supervisor';
  const currentUser = settings.users.find((user) => user.id === currentUserId) ?? null;

  return (
    <main className="settings-cockpit" data-role={currentRole}>
      <IndustrialPageHeader
        eyebrow="Access, profile and data controls"
        title="System"
        accent="Settings"
        metric={currentRole === 'supervisor' ? 'SUP' : 'INS'}
        description="Team access, profile, appearance and data controls follow existing role permissions."
        status={<Badge tone={canManageUsers ? 'ok' : 'muted'}>{canManageUsers ? 'Supervisor controls' : 'Personal settings'}</Badge>}
      />

      <section className="settings-summary" aria-label="Settings summary">
        <SettingsMetric icon={<LogOut />} label="Profile" value={currentUser?.displayName ?? 'User'} detail={currentRole} tone="green" />
        {canManageUsers && <SettingsMetric icon={<Users />} label="Active users" value={activeUsers} detail={`${settings.users.length} total`} tone="blue" />}
        <SettingsMetric icon={<Palette />} label="Theme" value={settings.appearance.mode} detail={settings.appearance.compactMode ? 'Compact layout' : 'Standard layout'} tone="orange" />
        {canManageUsers && <SettingsMetric icon={<Database />} label="Exports" value="CSV / JSON" detail="Data management" tone="navy" />}
      </section>

      <section className="settings-layout">
        {canManageUsers && (
          <div className="settings-layout__team">
            <Panel
              title="Team access"
              action={
                <button
                  className="settings-icon-button"
                  type="button"
                  aria-label={addUserOpen ? 'Close add user form' : 'Add user'}
                  aria-expanded={addUserOpen}
                  onClick={() => setAddUserOpen((open) => !open)}
                >
                  {addUserOpen ? <X aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
                </button>
              }
            >
              {addUserOpen && (
                <form className="settings-form settings-form--inline" action={createFormAction}>
                  <label>
                    <span>Display name</span>
                    <input name="displayName" placeholder="Musa Abubakar" required />
                  </label>
                  <label>
                    <span>Username</span>
                    <input name="username" placeholder="alex" required />
                  </label>
                  <label>
                    <span>Temporary password</span>
                    <input name="password" type="password" minLength={12} required />
                  </label>
                  <label>
                    <span>Role</span>
                    <select name="role" defaultValue="installer">
                      <option value="installer">Installer</option>
                      <option value="supervisor">Supervisor</option>
                    </select>
                  </label>
                  <label>
                    <span>Company</span>
                    <select name="company" defaultValue="">
                      <option value="">DTC / unassigned</option>
                      <option value="mrs">MRS</option>
                      <option value="dangote">Dangote</option>
                    </select>
                  </label>
                  {createState.status !== 'idle' && (
                    <p className={`banner ${createState.status === 'error' ? 'banner--error' : 'banner--success'}`}>
                      {createState.message}
                    </p>
                  )}
                  <button className="btn btn--primary" type="submit">
                    Add user
                  </button>
                </form>
              )}

              <DataTable
                columns={['Name', 'Username', 'Role', 'Company', 'Status', 'Last login', 'Action']}
                rows={settings.users.map((user) => [
                  <span key={`${user.id}-name`} className="settings-user-cell">
                    <strong>{user.displayName}</strong>
                    {user.id === currentUserId && <span>You</span>}
                  </span>,
                  user.username,
                  <span key={`${user.id}-role`} className="settings-role-pill" data-role={user.role}>
                    {user.role}
                  </span>,
                  user.company ?? '-',
                  <span key={`${user.id}-status`} className="settings-status-pill" data-active={user.isActive}>
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>,
                  user.lastLogin ? formatDate(user.lastLogin) : 'Never',
                  canManageUsers ? (
                    <form key={user.id} action={setUserActiveAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="isActive" value={user.isActive ? 'false' : 'true'} />
                      <button className="btn btn--secondary btn--compact" type="submit" disabled={user.id === currentUserId}>
                        {user.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </form>
                  ) : (
                    '-'
                  ),
                ])}
                emptyLabel="No users found."
              />
            </Panel>
          </div>
        )}
        <div className="settings-layout__profile">
          <Panel title="Profile" action={<LogOut className="settings-panel-icon" aria-hidden="true" />}>
            <div className="settings-profile">
              <div className="settings-profile__identity">
                <strong>{currentUser?.displayName ?? 'Current user'}</strong>
                <span>{currentUser?.username ?? 'Signed in'}</span>
                <span className="settings-role-pill" data-role={currentRole}>{currentRole}</span>
              </div>
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => void signOut({ callbackUrl: '/login' })}
              >
                Sign out
              </button>
            </div>
            <form className="settings-form" action={passwordFormAction}>
              <label>
                <span>Current password</span>
                <input name="currentPassword" type="password" autoComplete="current-password" required />
              </label>
              <label>
                <span>New password</span>
                <input name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
              </label>
              <label>
                <span>Confirm new password</span>
                <input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required />
              </label>
              {passwordState.status !== 'idle' && (
                <p className={`banner ${passwordState.status === 'error' ? 'banner--error' : 'banner--success'}`}>
                  {passwordState.message}
                </p>
              )}
              <button className="btn btn--primary" type="submit">
                Change password
              </button>
            </form>
          </Panel>
        </div>

        <div className="settings-layout__appearance">
          <Panel title="Appearance" action={<Palette className="settings-panel-icon" aria-hidden="true" />}>
            <form className="settings-form" action={setAppearanceAction}>
              <fieldset className="settings-segmented">
                <legend>Mode</legend>
                {(['system', 'light', 'dark'] as const).map((mode) => (
                  <label key={mode}>
                    <input type="radio" name="mode" value={mode} defaultChecked={settings.appearance.mode === mode} />
                    <span>{mode}</span>
                  </label>
                ))}
              </fieldset>
              <label className="settings-check">
                <input
                  type="checkbox"
                  name="compactMode"
                  value="true"
                  defaultChecked={settings.appearance.compactMode}
                />
                <span>Compact field layout</span>
              </label>
              <button className="btn btn--secondary" type="submit">
                Save appearance
              </button>
            </form>
          </Panel>
        </div>

        {canManageUsers && (
          <div className="settings-layout__data" id="exports">
            <Panel title="Exports" action={<Database className="settings-panel-icon" aria-hidden="true" />}>
              <p className="settings-panel-copy">Export operational records in CSV or JSON.</p>
              <div className="export-list" role="list">
                {exportSummaries.map((item) => (
                  <article className="export-row" key={item.key} role="listitem">
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
          </div>
        )}
      </section>
    </main>
  );
}

function SettingsMetric({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: string;
  tone: 'blue' | 'green' | 'orange' | 'navy';
}) {
  return (
    <article className="settings-metric" data-tone={tone}>
      <span className="settings-metric__icon" aria-hidden="true">
        {icon}
      </span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </span>
    </article>
  );
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-GB", {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value * 1000));
}
