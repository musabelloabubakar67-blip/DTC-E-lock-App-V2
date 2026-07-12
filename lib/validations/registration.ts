// Shared Zod schema — used by app/api/registrations/route.ts AND the register/page.tsx form.
import { z } from 'zod';

const yesNo = z.enum(['yes', 'no']);

export const registerKitSchema = z.object({
  motherSerial: z.string().trim().min(1, 'Mother serial is required'),
  subSerials: z
    .tuple([z.string().trim().min(1), z.string().trim().min(1), z.string().trim().min(1)])
    .describe('Exactly 3 sub-lock serials (§9)'),
  simNumber: z.string().trim().min(1, 'SIM number is required'),
  ipConfigured: yesNo.optional(),
  apnConfigured: yesNo.optional(),
  apnAuthSet: yesNo.optional(),
  btWriteDone: yesNo.optional(),
});

export type RegisterKitFormValues = z.infer<typeof registerKitSchema>;
