// Shared Zod schema — used by app/api/movements/route.ts AND the movement/page.tsx form.
import { z } from 'zod';

const removalReason = z.enum([
  'faulty',
  'damaged',
  'operational_swap',
  'decommissioned',
  'unlogged_swap_detected',
  'other',
]);
const disposition = z.enum(['repair_pool', 'available_pool', 'retired']);

const faultDetailsSchema = z.object({
  description: z.string().trim().min(1),
  locksAffected: z.array(z.string()).min(1),
  reportedBy: z
    .enum(['station_manager', 'customer_rep', 'driver', 'team_member', 'self_identified'])
    .optional(),
  faultType: z
    .enum([
      'device_offline',
      'dynamic_password_failed',
      'sub_lock_not_opening',
      'charging_failure',
      'configuration_error',
      'hardware_damage',
      'seal_discrepancy',
      'other',
    ])
    .optional(),
  truckLocation: z.enum(['in_transit', 'customer_location', 'installation_point']).optional(),
  deviceOnline: z.enum(['yes', 'no', 'intermittent']).optional(),
  remoteOpen: z.enum(['success', 'failed', 'not_applicable']).optional(),
  staticPwUsed: z.enum(['yes', 'no']).optional(),
  staticPwAuthBy: z.string().nullable().optional(),
  resolution: z
    .enum([
      'resolved_remotely',
      'static_password_issued',
      'device_reconfigured',
      'device_replaced',
      'pending',
      'escalated',
    ])
    .optional(),
  minutesToResolve: z.number().int().nonnegative().optional(),
  followupRequired: z.enum(['yes', 'no']).optional(),
  followupDetails: z.string().optional(),
  incidentStatus: z.enum(['closed', 'open_pending_followup']).optional(),
  closureBy: z.string().nullable().optional(),
});

export const replaceSubLockSchema = z.object({
  kind: z.literal('sub_replacement'),
  truckId: z.string().trim().min(1),
  motherDeviceId: z.string().trim().min(1),
  slot: z.enum(['B', 'C', 'D']),
  newSubDeviceId: z.string().trim().min(1),
  reason: removalReason,
  disposition: disposition.optional(),
  notes: z.string().optional(),
  faultDetails: faultDetailsSchema.optional(),
});

export const resolveTruckSwapSchema = z.object({
  kind: z.literal('truck_swap'),
  deviceId: z.string().trim().min(1),
  toTruckId: z.string().trim().min(1),
});

export const removeDeviceFromTruckSchema = z.object({
  kind: z.literal('removed_to_inventory'),
  motherDeviceId: z.string().trim().min(1),
  reason: removalReason,
  disposition: disposition.optional(),
  notes: z.string().optional(),
});

export const decommissionDeviceSchema = z.object({
  kind: z.literal('decommissioned'),
  motherDeviceId: z.string().trim().min(1),
  notes: z.string().optional(),
});

export const replaceMotherLockSchema = z.object({
  kind: z.literal('mother_replacement'),
  truckId: z.string().trim().min(1),
  newMotherDeviceId: z.string().trim().min(1),
  reason: removalReason,
  disposition: disposition.optional(),
  notes: z.string().optional(),
});

export const assignMotherToTruckSchema = z.object({
  kind: z.literal('new_assignment'),
  truckId: z.string().trim().min(1),
  motherDeviceId: z.string().trim().min(1),
});

export const movementActionSchema = z.discriminatedUnion('kind', [
  replaceSubLockSchema,
  resolveTruckSwapSchema,
  removeDeviceFromTruckSchema,
  decommissionDeviceSchema,
  replaceMotherLockSchema,
  assignMotherToTruckSchema,
]);

export type MovementActionFormValues = z.infer<typeof movementActionSchema>;
