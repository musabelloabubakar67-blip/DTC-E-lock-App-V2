// Human-readable reports: one row = one thing, serials/plates/names instead of internal ids,
// Lagos local dates instead of unix seconds.

export type ReportKey = 'fleet_status' | 'installations' | 'movements' | 'device_inventory' | 'faults';

export type ExportReport = {
  key: ReportKey;
  label: string;
  description: string;
  sql: string;
  countSql: string;
  humanize: string[];
};

const LAGOS = `'+1 hour'`;
const fmt = (column: string) =>
  `case when ${column} is null then null else strftime('%Y-%m-%d %H:%M', ${column}, 'unixepoch', ${LAGOS}) end`;
const day = (column: string) =>
  `case when ${column} is null then null else strftime('%Y-%m-%d', ${column}, 'unixepoch', ${LAGOS}) end`;

const openSub = (motherExpr: string, slot: string) => `(
  select d.serial from slot_pairings sp join devices d on d.id = sp.sub_device_id
  where sp.mother_device_id = ${motherExpr} and sp.slot = '${slot}' and sp.unpaired_at is null
)`;

const subAtInstall = (slot: string) => `(
  select d.serial from slot_pairings sp join devices d on d.id = sp.sub_device_id
  where sp.mother_device_id = il.mother_device_id and sp.slot = '${slot}'
    and sp.paired_at <= il.logged_date + 300
    and (sp.unpaired_at is null or sp.unpaired_at >= il.logged_date)
  order by sp.paired_at desc limit 1
)`;

const latestVerification = (column: string) => `(
  select ${column} from verifications v where v.truck_id = t.id order by v.verified_at desc limit 1
)`;

export const EXPORT_REPORTS: ExportReport[] = [
  {
    key: 'fleet_status',
    label: 'Fleet status',
    description: 'One row per truck: current company, the four locks on it, when installed and last verified.',
    humanize: ['Kit status', 'Last verification result'],
    countSql: `select count(*) as count from trucks where org_id = @org`,
    sql: `
      select
        t.plate as "Truck",
        case when t.is_active = 1 then 'Active' else 'Inactive' end as "Truck status",
        upper(tca.company) as "Company",
        m.serial as "Mother lock",
        ${openSub('ta.device_id', 'B')} as "Sub-lock B",
        ${openSub('ta.device_id', 'C')} as "Sub-lock C",
        ${openSub('ta.device_id', 'D')} as "Sub-lock D",
        case
          when ta.id is null then 'no_kit'
          when (select count(*) from slot_pairings sp where sp.mother_device_id = ta.device_id and sp.unpaired_at is null) = 3 then 'complete'
          else 'incomplete'
        end as "Kit status",
        ${day('ta.assigned_at')} as "Kit on truck since",
        (select u.display_name from installation_logs il join users u on u.id = il.actor_user_id
          where il.truck_id = t.id order by il.logged_date desc limit 1) as "Last installed by",
        ${fmt(latestVerification('v.verified_at'))} as "Last verified",
        cast((unixepoch() - ${latestVerification('v.verified_at')}) / 86400 as integer) as "Days since verified",
        ${latestVerification('v.result')} as "Last verification result",
        (select u.display_name from verifications v join users u on u.id = v.verified_by
          where v.truck_id = t.id order by v.verified_at desc limit 1) as "Last verified by"
      from trucks t
      left join truck_assignments ta on ta.truck_id = t.id and ta.removed_at is null
      left join devices m on m.id = ta.device_id
      left join truck_company_assignments tca on tca.truck_id = t.id and tca.removed_at is null
      where t.org_id = @org
      order by t.is_active desc, t.plate`,
  },
  {
    key: 'installations',
    label: 'Installations',
    description: 'One row per install: date, truck, installer, the four serials and the checklist result.',
    humanize: ['Result', 'Battery', 'Online after install'],
    countSql: `select count(*) as count from installation_logs where org_id = @org`,
    sql: `
      select
        ${fmt('il.logged_date')} as "Date",
        t.plate as "Truck",
        u.display_name as "Installer",
        m.serial as "Mother lock",
        ${subAtInstall('B')} as "Sub-lock B",
        ${subAtInstall('C')} as "Sub-lock C",
        ${subAtInstall('D')} as "Sub-lock D",
        il.overall_status as "Result",
        il.battery_level as "Battery",
        il.online_after as "Online after install",
        il.issues_notes as "Issues noted"
      from installation_logs il
      join trucks t on t.id = il.truck_id
      join devices m on m.id = il.mother_device_id
      join users u on u.id = il.actor_user_id
      where il.org_id = @org
      order by il.logged_date desc`,
  },
  {
    key: 'movements',
    label: 'Movements & repairs',
    description: 'One row per swap, replacement or removal: which lock came off, which went on, why, and who did it.',
    humanize: ['Action', 'Reason', 'Removed lock sent to'],
    countSql: `select count(*) as count from movement_logs where org_id = @org`,
    sql: `
      select
        ${fmt('ml.logged_date')} as "Date",
        ml.action as "Action",
        t.plate as "Truck",
        st.plate as "From truck",
        ml.slot as "Slot",
        od.serial as "Lock removed",
        ml.out_reason as "Reason",
        ml.out_disposition as "Removed lock sent to",
        ind.serial as "Lock fitted",
        u.display_name as "Done by",
        trim(coalesce(ml.reason_notes, '') || ' ' || coalesce(ml.notes, '')) as "Notes"
      from movement_logs ml
      left join trucks t on t.id = ml.truck_id
      left join trucks st on st.id = ml.source_truck_id
      left join devices od on od.id = ml.out_device_id
      left join devices ind on ind.id = ml.in_device_id
      join users u on u.id = ml.actor_user_id
      where ml.org_id = @org
      order by ml.logged_date desc`,
  },
  {
    key: 'device_inventory',
    label: 'Device inventory',
    description: 'One row per lock: type, status, which truck and slot it is on now, and which kit it is registered to.',
    humanize: ['Type', 'Status', 'Origin'],
    countSql: `select count(*) as count from devices where org_id = @org`,
    sql: `
      select
        d.serial as "Serial",
        d.device_type as "Type",
        d.lifecycle_status as "Status",
        case
          when d.device_type = 'mother' then (select t.plate from truck_assignments ta join trucks t on t.id = ta.truck_id
            where ta.device_id = d.id and ta.removed_at is null)
          else (select t.plate from slot_pairings sp
            join truck_assignments ta on ta.device_id = sp.mother_device_id and ta.removed_at is null
            join trucks t on t.id = ta.truck_id
            where sp.sub_device_id = d.id and sp.unpaired_at is null)
        end as "On truck",
        (select sp.slot from slot_pairings sp where sp.sub_device_id = d.id and sp.unpaired_at is null) as "Slot",
        case
          when d.device_type = 'mother' then null
          else (select pm.serial from slot_pairings sp join devices pm on pm.id = sp.mother_device_id
            where sp.sub_device_id = d.id and sp.unpaired_at is null)
        end as "Installed under mother",
        case
          when d.device_type = 'mother' then (select count(*) from kit_members km where km.mother_device_id = d.id and km.removed_at is null) || ' of 3 sub-locks registered'
          else (select rm.serial from kit_members km join devices rm on rm.id = km.mother_device_id
            where km.sub_device_id = d.id and km.removed_at is null)
        end as "Registered kit",
        d.sim_number as "SIM",
        ${day('d.registered_at')} as "Registered on",
        (select u.display_name from users u where u.id = d.registered_by) as "Registered by",
        d.origin as "Origin",
        case when d.ownership_status = 'owned' then 'DTC' else 'Released externally' end as "Ownership"
      from devices d
      where d.org_id = @org
      order by d.device_type, d.serial`,
  },
  {
    key: 'faults',
    label: 'Faults',
    description: 'One row per fault report: truck, lock, what went wrong, how it was resolved, and whether it is still open.',
    humanize: ['Fault type', 'Reported by', 'Resolution', 'Incident status', 'Follow-up needed', 'Device online'],
    countSql: `select count(*) as count from fault_reports where org_id = @org`,
    sql: `
      select
        ${fmt('fr.logged_date')} as "Date",
        t.plate as "Truck",
        d.serial as "Lock",
        case when d.device_type = 'mother' then 'Mother' else 'Sub' end as "Lock type",
        replace(replace(replace(fr.locks_affected, '[', ''), ']', ''), '"', '') as "Locks affected",
        fr.fault_type as "Fault type",
        fr.description as "Description",
        fr.reported_by as "Reported by",
        fr.device_online as "Device online",
        fr.resolution as "Resolution",
        fr.minutes_to_resolve as "Minutes to resolve",
        fr.incident_status as "Incident status",
        fr.followup_required as "Follow-up needed",
        fr.followup_details as "Follow-up details",
        u.display_name as "Logged by"
      from fault_reports fr
      join trucks t on t.id = fr.truck_id
      join devices d on d.id = fr.device_id
      join users u on u.id = fr.actor_user_id
      where fr.org_id = @org
      order by fr.logged_date desc`,
  },
];

export function humanizeValue(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;
  const text = value.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
