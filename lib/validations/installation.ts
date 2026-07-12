// Shared Zod schema — used by app/api/installations/route.ts AND the install/page.tsx form.
import { z } from 'zod';

const yesNo = z.enum(['yes', 'no']);

export const installChecklistSchema = z.object({
  batteryLevel: z.enum(['full', 'adequate', 'low', 'dead']).optional(),
  physicalDamage: z.enum(['none', 'minor', 'significant']).optional(),
  deviceResponsive: yesNo.optional(),
  sublocksResponsive: yesNo.optional(),
  configConfirmed: z.enum(['yes', 'no', 'changed']).optional(),
  configNotes: z.string().optional(),
  btUnlockDone: yesNo.optional(),
  onlineAfter: z.enum(['yes', 'no', 'intermittent']).optional(),
  motherLocked: yesNo.optional(),
  motherSecured: yesNo.optional(),
  sublocksLocked: z.enum(['all', 'partial', 'none']).optional(),
  sublocksSecured: yesNo.optional(),
  overallStatus: z.enum(['successful', 'completed_with_issues', 'failed']).optional(),
  issuesNotes: z.string().optional(),
});

export const installKitSchema = z.object({
  installMode: z.enum(['same_kit', 'changed']).optional(),
  truckId: z.string().trim().min(1, 'Truck is required'),
  motherDeviceId: z.string().trim().min(1, 'Mother device is required'),
  subDeviceIds: z.tuple([
    z.string().trim().min(1),
    z.string().trim().min(1),
    z.string().trim().min(1),
  ]),
  // §2/§6: confirmed at EVERY install, not declared once. Always required on the form —
  // pre-filled with the truck's current value if one exists, blank if not (§6 "the tech
  // confirms it (leaves it) or changes it"). The server re-reads current state itself and only
  // writes truck_company_assignments when the submitted value actually differs (§6 "the server
  // does not trust a client-only 'no change' signal").
  company: z.enum(['mrs', 'dangote'], { required_error: 'Serving company is required' }),
  checklist: installChecklistSchema.optional(),
});

export type InstallKitFormValues = z.infer<typeof installKitSchema>;
