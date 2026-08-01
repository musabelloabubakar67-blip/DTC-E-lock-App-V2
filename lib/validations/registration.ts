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

export const registerIncompleteKitSchema = z.object({
  motherSerial: z.string().trim().regex(/^\d{12}$/, 'Mother serial must be 12 digits'),
  subSerials: z
    .array(z.string().trim().regex(/^[0-9A-Fa-f]{12}$/, 'Sub-lock serials must be 12 hexadecimal characters'))
    .max(2, 'Incomplete registrations can contain at most two sub-locks'),
  simNumber: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().regex(/^\d{10,15}$/, 'SIM number must contain 10 to 15 digits').optional(),
  ),
  notes: z.string().trim().max(500).optional(),
}).superRefine((value, context) => {
  const serials = [value.motherSerial.toUpperCase(), ...value.subSerials.map((serial) => serial.toUpperCase())];
  if (new Set(serials).size !== serials.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'All supplied device serials must be distinct' });
  }
});

export type RegisterKitFormValues = z.infer<typeof registerKitSchema>;
export type RegisterIncompleteKitFormValues = z.infer<typeof registerIncompleteKitSchema>;
