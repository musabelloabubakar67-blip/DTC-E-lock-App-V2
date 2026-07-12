// Shared Zod schema — used by app/api/faults/route.ts AND the fault/page.tsx form.
import { z } from 'zod';

const yesNo = z.enum(['yes', 'no']);

export const createFaultReportSchema = z.object({
  truckId: z.string().trim().min(1, 'Truck is required'),
  deviceId: z.string().trim().min(1, 'Device is required'),
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
  locksAffected: z.array(z.string()).min(1, 'At least one affected lock is required'),
  truckLocation: z.enum(['in_transit', 'customer_location', 'installation_point']).optional(),
  deviceOnline: z.enum(['yes', 'no', 'intermittent']).optional(),
  description: z.string().trim().min(1, 'Description is required'),
  remoteOpen: z.enum(['success', 'failed', 'not_applicable']).optional(),
  staticPwUsed: yesNo.optional(),
  staticPwAuthBy: z.string().trim().min(1).nullable().optional(),
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
  followupRequired: yesNo.optional(),
  followupDetails: z.string().optional(),
  incidentStatus: z.enum(['closed', 'open_pending_followup']).optional(),
  closureBy: z.string().trim().min(1).nullable().optional(),
  notes: z.string().optional(),
});

export type CreateFaultReportFormValues = z.infer<typeof createFaultReportSchema>;
