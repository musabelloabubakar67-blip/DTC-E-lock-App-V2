import { z } from 'zod';

export const repairPositionSchema = z.enum(['mother', 'B', 'C', 'D']);

export const repairBatchSchema = z
  .object({
    truck: z.string().trim().min(1, 'Truck plate is required'),
    reason: z.enum(['faulty', 'damaged']),
    description: z.string().trim().min(1, 'Describe the fault or damage'),
    notes: z.string().trim().optional(),
    items: z
      .array(
        z.object({
          position: repairPositionSchema,
          replacementSerial: z.string().trim().min(1).optional(),
        }),
      )
      .min(1, 'Select at least one device')
      .max(4),
  })
  .superRefine((value, context) => {
    const positions = value.items.map((item) => item.position);
    if (new Set(positions).size !== positions.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Each kit position can only be selected once',
      });
    }

    const replacements = value.items
      .map((item) => item.replacementSerial?.trim().toUpperCase())
      .filter((serial): serial is string => Boolean(serial));
    if (new Set(replacements).size !== replacements.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'A replacement device cannot fill more than one position',
      });
    }
  });

export type RepairBatchFormValues = z.infer<typeof repairBatchSchema>;
