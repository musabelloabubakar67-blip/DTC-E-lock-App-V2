import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { devices, trucks } from '../db/schema';
import { BusinessError } from '../lib/errors';
import { createFaultReportSchema } from '../lib/validations/fault';
import { installChecklistSchema } from '../lib/validations/installation';
import { createFaultReport } from './fault.service';
import { recordInstallation } from './installation.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any;

export const nativeInstallSchema = z.object({
  installMode: z.enum(['same_kit', 'changed']).optional(),
  truckPlate: z.string().trim().min(1, 'Truck plate is required'),
  motherSerial: z.string().trim().min(1, 'Mother serial is required'),
  subSerials: z.tuple([
    z.string().trim().min(1),
    z.string().trim().min(1),
    z.string().trim().min(1),
  ]),
  company: z.enum(['mrs', 'dangote']),
  checklist: installChecklistSchema.optional(),
});

export const nativeFaultSchema = createFaultReportSchema
  .omit({ truckId: true, deviceId: true })
  .extend({
    truckPlate: z.string().trim().min(1, 'Truck plate is required'),
    deviceSerial: z.string().trim().min(1, 'Device serial is required'),
  });

type NativeInstall = z.infer<typeof nativeInstallSchema>;
type NativeFault = z.infer<typeof nativeFaultSchema>;

export function recordNativeInstallation(
  db: DbClient,
  params: { orgId: string; actorUserId: string; payload: NativeInstall },
) {
  const truckPlate = params.payload.truckPlate.toUpperCase();
  const motherSerial = params.payload.motherSerial.toUpperCase();
  const subSerials = params.payload.subSerials.map((serial) => serial.toUpperCase()) as [string, string, string];
  const truck = db
    .select({ id: trucks.id })
    .from(trucks)
    .where(and(eq(trucks.orgId, params.orgId), eq(trucks.plate, truckPlate)))
    .get();
  if (!truck) throw new BusinessError(`Truck ${truckPlate} was not found`);

  const kitDevices: { id: string; serial: string; deviceType: string }[] = db
    .select({ id: devices.id, serial: devices.serial, deviceType: devices.deviceType })
    .from(devices)
    .where(and(eq(devices.orgId, params.orgId), inArray(devices.serial, [motherSerial, ...subSerials])))
    .all();
  const bySerial = new Map(kitDevices.map((device) => [device.serial.toUpperCase(), device]));
  const mother = bySerial.get(motherSerial);
  if (!mother || mother.deviceType !== 'mother') throw new BusinessError(`Mother lock ${motherSerial} was not found`);

  const subs = subSerials.map((serial) => {
    const device = bySerial.get(serial);
    if (!device || device.deviceType !== 'sub') throw new BusinessError(`Sub-lock ${serial} was not found`);
    return device;
  });

  return recordInstallation(db, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    installMode: params.payload.installMode,
    truckId: truck.id,
    motherDeviceId: mother.id,
    subDeviceIds: [subs[0].id, subs[1].id, subs[2].id],
    company: params.payload.company,
    checklist: params.payload.checklist,
  });
}

export function createNativeFaultReport(
  db: DbClient,
  params: { orgId: string; actorUserId: string; payload: NativeFault },
) {
  const truckPlate = params.payload.truckPlate.toUpperCase();
  const deviceSerial = params.payload.deviceSerial.toUpperCase();
  const truck = db
    .select({ id: trucks.id })
    .from(trucks)
    .where(and(eq(trucks.orgId, params.orgId), eq(trucks.plate, truckPlate)))
    .get();
  if (!truck) throw new BusinessError(`Truck ${truckPlate} was not found`);

  const device = db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.orgId, params.orgId), eq(devices.serial, deviceSerial)))
    .get();
  if (!device) throw new BusinessError(`Device ${deviceSerial} was not found`);

  const { truckPlate: _truckPlate, deviceSerial: _deviceSerial, ...fault } = params.payload;
  return createFaultReport(db, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    truckId: truck.id,
    deviceId: device.id,
    ...fault,
  });
}
