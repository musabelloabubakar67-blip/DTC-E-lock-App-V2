import type { InstallKitFormValues } from '../../../lib/validations/installation';

export type InstallationShareDetails = {
  truck: string;
  company: InstallKitFormValues['company'];
  mother: string;
  subs: [string, string, string];
};

const INTERNAL_ID = /^(?:dev|trk)_[a-z0-9]+$/i;

export function buildInstallationWhatsAppMessage(details: InstallationShareDetails): string {
  return [
    externalLabel(details.truck, 'Recorded truck', 'upper'),
    `Master: ${externalLabel(details.mother, 'Recorded in E-Lock', 'upper')}`,
    `C1: ${externalLabel(details.subs[0], 'Recorded in E-Lock', 'lower')}`,
    `C2: ${externalLabel(details.subs[1], 'Recorded in E-Lock', 'lower')}`,
    `C3: ${externalLabel(details.subs[2], 'Recorded in E-Lock', 'lower')}`,
  ].join('\n');
}

export function buildInstallationWhatsAppUrl(details: InstallationShareDetails): string {
  return `https://wa.me/?text=${encodeURIComponent(buildInstallationWhatsAppMessage(details))}`;
}

function externalLabel(value: string, fallback: string, casing: 'upper' | 'lower'): string {
  const trimmed = value.trim();
  if (!trimmed || INTERNAL_ID.test(trimmed)) return fallback;
  return casing === 'upper' ? trimmed.toUpperCase() : trimmed.toLowerCase();
}
