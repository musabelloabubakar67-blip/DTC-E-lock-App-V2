// Shared Zod schema — used by app/api/verifications/route.ts, sync.service.ts's offline
// replay, AND the verify/page.tsx form. §3 kit-scan: mother + subs, each tagged qr_scan|manual.
import { z } from 'zod';

const verificationTier = z.enum(['qr_scan', 'manual']);

export const recordKitVerificationSchema = z.object({
  truckId: z.string().trim().min(1).optional(),
  motherSerial: z.string().trim().min(1, 'Mother serial is required'),
  motherSource: verificationTier,
  subs: z
    .array(
      z.object({
        serial: z.string().trim().min(1),
        source: verificationTier,
      }),
    )
    .min(1, 'At least one sub must be scanned or entered')
    .max(3, 'A kit has at most 3 sub-locks'),
});

export type RecordKitVerificationFormValues = z.infer<typeof recordKitVerificationSchema>;
