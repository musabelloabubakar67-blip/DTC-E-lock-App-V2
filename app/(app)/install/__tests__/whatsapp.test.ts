import { describe, expect, it } from 'vitest';
import { buildInstallationWhatsAppMessage, buildInstallationWhatsAppUrl } from '../whatsapp';

const details = {
  truck: 'fze185di',
  company: 'mrs' as const,
  mother: '487068973097',
  subs: ['E0817BE15DA8', 'FA7951A73B03', 'D2611F865C82'] as [string, string, string],
};

describe('installation WhatsApp handover', () => {
  it('formats the operational installation details', () => {
    const message = buildInstallationWhatsAppMessage(details);

    expect(message).toBe([
      'FZE185DI',
      'Master: 487068973097',
      'C1: e0817be15da8',
      'C2: fa7951a73b03',
      'C3: d2611f865c82',
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
    expect(message).toContain('Master: Recorded in E-Lock');
  });

  it('creates a prefilled WhatsApp URL', () => {
    const url = buildInstallationWhatsAppUrl(details);

    expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(url.split('text=')[1])).toBe(buildInstallationWhatsAppMessage(details));
  });
});
