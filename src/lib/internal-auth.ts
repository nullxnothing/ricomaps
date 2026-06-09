import { NextRequest } from 'next/server';
import crypto from 'crypto';

/**
 * Shared-secret auth for worker→app internal endpoints. Constant-time compare;
 * a missing INTERNAL_API_SECRET disables the endpoints entirely (fail closed).
 */
export function isAuthorizedInternal(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  const provided = request.headers.get('x-internal-secret');
  if (!secret || !provided) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
