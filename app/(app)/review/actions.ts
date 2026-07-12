// Client-side logic for review/page.tsx.
export type ConflictReviewListItem = {
  id: string;
  kind: 'sync_conflict' | 'unlogged_swap' | 'import_conflict';
  status: 'open' | 'resolved' | 'dismissed';
  payload: Record<string, unknown>;
  createdAt: number;
};

export async function fetchOpenReviews(): Promise<ConflictReviewListItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch('/api/reviews', { signal: controller.signal });
    if (!response.ok) return [];
    const body = await response.json().catch(() => null);
    return body?.data ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export type SubmitReviewActionResult = { status: 'success' } | { status: 'error'; message: string };

export async function submitReviewAction(
  reviewId: string,
  action: 'resolve' | 'dismiss',
  resolutionNotes?: string,
): Promise<SubmitReviewActionResult> {
  try {
    const response = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId, action, resolutionNotes }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.data) {
      return { status: 'error', message: body?.error?.message ?? `Review action failed (HTTP ${response.status})` };
    }
    return { status: 'success' };
  } catch {
    return { status: 'error', message: 'Review action failed: could not reach server' };
  }
}
