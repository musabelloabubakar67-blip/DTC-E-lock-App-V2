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
    `Truck: ${externalLabel(details.truck, 'Recorded truck')}`,
    `Serving company: ${details.company.toUpperCase()}`,
    `Mother lock: ${externalLabel(details.mother, 'Recorded in E-Lock')}`,
    `Sub-lock B: ${externalLabel(details.subs[0], 'Recorded in E-Lock')}`,
    `Sub-lock C: ${externalLabel(details.subs[1], 'Recorded in E-Lock')}`,
    `Sub-lock D: ${externalLabel(details.subs[2], 'Recorded in E-Lock')}`,
  ].join('\n');
}

export function buildInstallationWhatsAppUrl(details: InstallationShareDetails): string {
  return `https://wa.me/?text=${encodeURIComponent(buildInstallationWhatsAppMessage(details))}`;
}

function externalLabel(value: string, fallback: string): string {
  const trimmed = value.trim();
  return !trimmed || INTERNAL_ID.test(trimmed) ? fallback : trimmed;
}
