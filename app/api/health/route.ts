import { NextResponse } from 'next/server';
import { sqlite } from '../../../db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    sqlite.prepare('SELECT 1').get();
    const migration = sqlite
      .prepare('SELECT name FROM _migrations ORDER BY name DESC LIMIT 1')
      .get() as { name?: string } | undefined;

    return NextResponse.json(
      {
        status: 'ok',
        database: 'ready',
        migration: migration?.name ?? null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { status: 'unavailable', database: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
