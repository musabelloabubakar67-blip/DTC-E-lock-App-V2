import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '../../../../lib/auth';
import { db } from '../../../../db';
import { devices, trucks } from '../../../../db/schema';
import { BusinessError, AuthzError } from '../../../../lib/errors';
import { installChecklistSchema } from '../../../../lib/validations/installation';
import { requireAuthenticated } from '../../../../services/auth.service';
import { recordInstallation } from '../../../../services/installation.service';

const nativeInstallSchema = z.object({
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

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );
    const parsed = nativeInstallSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Invalid installation' } },
        { status: 400 },
      );
    }

    const truckPlate = parsed.data.truckPlate.toUpperCase();
    const motherSerial = parsed.data.motherSerial.toUpperCase();
    const subSerials = parsed.data.subSerials.map((serial) => serial.toUpperCase()) as [string, string, string];
    const truck = db
      .select({ id: trucks.id })
      .from(trucks)
      .where(and(eq(trucks.orgId, user.orgId), eq(trucks.plate, truckPlate)))
      .get();
    if (!truck) throw new BusinessError(`Truck ${truckPlate} was not found`);

    const kitDevices = db
      .select({ id: devices.id, serial: devices.serial, deviceType: devices.deviceType })
      .from(devices)
      .where(and(eq(devices.orgId, user.orgId), inArray(devices.serial, [motherSerial, ...subSerials])))
      .all();
    const bySerial = new Map(kitDevices.map((device) => [device.serial.toUpperCase(), device]));
    const mother = bySerial.get(motherSerial);
    if (!mother || mother.deviceType !== 'mother') throw new BusinessError(`Mother lock ${motherSerial} was not found`);

    const subs = subSerials.map((serial) => {
      const device = bySerial.get(serial);
      if (!device || device.deviceType !== 'sub') throw new BusinessError(`Sub-lock ${serial} was not found`);
      return device;
    });

    const result = recordInstallation(db, {
      orgId: user.orgId,
      actorUserId: user.id,
      installMode: parsed.data.installMode,
      truckId: truck.id,
      motherDeviceId: mother.id,
      subDeviceIds: [subs[0].id, subs[1].id, subs[2].id],
      company: parsed.data.company,
      checklist: parsed.data.checklist,
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: { code: 'business_error', message: error.message } }, { status: 409 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Installation failed' } },
      { status: 500 },
    );
  }
}
