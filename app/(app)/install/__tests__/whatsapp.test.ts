import { describe, expect, it } from 'vitest';
import { buildInstallationWhatsAppMessage, buildInstallationWhatsAppUrl } from '../whatsapp';

const details = {
  truck: 'FZE 998 DI',
  company: 'mrs' as const,
  mother: 'MTR-003892',
  subs: ['SUB-01', 'SUB-02', 'SUB-03'] as [string, string, string],
};

describe('installation WhatsApp handover', () => {
  it('formats the operational installation details', () => {
    const message = buildInstallationWhatsAppMessage(details);

    expect(message).toBe([
      'Truck: FZE 998 DI',
      'Serving company: MRS',
      'Mother lock: MTR-003892',
      'Sub-lock B: SUB-01',
      'Sub-lock C: SUB-02',
      'Sub-lock D: SUB-03',
    ].join('\n'));
  });

  it('keeps internal record identifiers out of the shared report', () => {
    const message = buildInstallationWhatsAppMessage({
      ...details,
      truck: 'trk_1084df8b5d7c4b688e99f9649c3f4607',
      mother: 'dev_1084df8b5d7c4b688e99f9649c3f4607',
      subs: ['dev_a', 'dev_b', 'dev_c'],
    });

    expect(message).not.toContain('trk_');
    expect(message).not.toContain('dev_');
    expect(message).toContain('Mother lock: Recorded in E-Lock');
  });

  it('creates a prefilled WhatsApp URL', () => {
    const url = buildInstallationWhatsAppUrl(details);

    expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(url.split('text=')[1])).toBe(buildInstallationWhatsAppMessage(details));
  });
});
