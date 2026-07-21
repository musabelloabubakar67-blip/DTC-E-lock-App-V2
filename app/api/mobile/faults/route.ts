import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '../../../../lib/auth';
import { db } from '../../../../db';
import { devices, trucks } from '../../../../db/schema';
import { BusinessError, AuthzError } from '../../../../lib/errors';
import { createFaultReportSchema } from '../../../../lib/validations/fault';
import { requireAuthenticated } from '../../../../services/auth.service';
import { createFaultReport } from '../../../../services/fault.service';

const nativeFaultSchema = createFaultReportSchema
  .omit({ truckId: true, deviceId: true })
  .extend({
    truckPlate: z.string().trim().min(1, 'Truck plate is required'),
    deviceSerial: z.string().trim().min(1, 'Device serial is required'),
  });

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );
    const parsed = nativeFaultSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Invalid fault report' } },
        { status: 400 },
      );
    }

    const truck = db.select({ id: trucks.id }).from(trucks)
      .where(and(eq(trucks.orgId, user.orgId), eq(trucks.plate, parsed.data.truckPlate.toUpperCase())))
      .get();
    if (!truck) throw new BusinessError(`Truck ${parsed.data.truckPlate.toUpperCase()} was not found`);

    const device = db.select({ id: devices.id }).from(devices)
      .where(and(eq(devices.orgId, user.orgId), eq(devices.serial, parsed.data.deviceSerial.toUpperCase())))
      .get();
    if (!device) throw new BusinessError(`Device ${parsed.data.deviceSerial.toUpperCase()} was not found`);

    const { truckPlate: _truckPlate, deviceSerial: _deviceSerial, ...fault } = parsed.data;
    const faultReportId = createFaultReport(db, {
      orgId: user.orgId,
      actorUserId: user.id,
      truckId: truck.id,
      deviceId: device.id,
      ...fault,
    });
    return NextResponse.json({ data: { faultReportId } }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: { code: 'business_error', message: error.message } }, { status: 409 });
    }
    return NextResponse.json({ error: { code: 'internal_error', message: 'Fault report failed' } }, { status: 500 });
  }
}
