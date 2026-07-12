// Thin route: session auth → review.service.ts → JSON (§10 GET/POST /api/reviews — supervisor
// for POST; GET is read-only and open to any authenticated user, same as the rest of the app).
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { db } from '../../../db';
import { listOpenConflictReviews, resolveConflictReview, dismissConflictReview } from '../../../services/review.service';
import { requireAuthenticated } from '../../../services/auth.service';
import { BusinessError, AuthzError } from '../../../lib/errors';

export async function GET() {
  const session = await getServerSession(authOptions);
  try {
    requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );
    return NextResponse.json({ data: listOpenConflictReviews(db) });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json({ error: { code: 'internal_error', message: 'Could not load reviews' } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const body = await request.json();
    const { reviewId, action, resolutionNotes } = body ?? {};
    if (!reviewId || (action !== 'resolve' && action !== 'dismiss')) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: 'reviewId and action ("resolve"|"dismiss") are required' } },
        { status: 400 },
      );
    }

    if (action === 'resolve') {
      resolveConflictReview(db, { reviewId, actor: user, resolutionNotes });
    } else {
      dismissConflictReview(db, { reviewId, actor: user, resolutionNotes });
    }

    return NextResponse.json({ data: { reviewId, status: action === 'resolve' ? 'resolved' : 'dismissed' } });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: { code: 'business_error', message: error.message } }, { status: 409 });
    }
    return NextResponse.json({ error: { code: 'internal_error', message: 'Review action failed' } }, { status: 500 });
  }
}
