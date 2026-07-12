export { VERIFY_DECAY_SCAN_DAYS, VERIFY_DECAY_PHOTO_DAYS } from '../config/client.config';

export const DEVICE_TYPES = ['mother', 'sub'] as const;
export const LIFECYCLE_STATUSES = [
  'available',
  'in_service',
  'repair',
  'faulty',
  'retired',
] as const;
export const USER_ROLES = ['installer', 'supervisor'] as const;
export const REMOVAL_REASONS = [
  'faulty',
  'damaged',
  'operational_swap',
  'decommissioned',
  'unlogged_swap_detected',
  'other',
] as const;
export const DISPOSITIONS = ['repair_pool', 'available_pool', 'retired'] as const;
export const SLOTS = ['B', 'C', 'D'] as const;
export const VERIFICATION_SOURCES = ['qr_scan', 'photo_attestation', 'manual'] as const;
export const VERIFICATION_RESULTS = ['match', 'mismatch_corrected'] as const;
export const TRUST_STATES = ['verified', 'stale', 'unverified'] as const;
export const MOVEMENT_ACTIONS = [
  'new_assignment',
  'mother_replacement',
  'sub_replacement',
  'truck_swap',
  'removed_to_inventory',
  'decommissioned',
  'unlogged_swap_detected',
  'triage',
] as const;
export const CONFLICT_REVIEW_KINDS = ['sync_conflict', 'unlogged_swap', 'import_conflict'] as const;
