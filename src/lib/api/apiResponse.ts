import { NextResponse } from 'next/server';

/**
 * Standard API error codes used across all routes.
 */
export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

const STATUS_MAP: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/**
 * Returns a standardized JSON error response.
 *
 * Usage:
 *   return apiError('NOT_FOUND', 'Chore not found');
 *   return apiError('VALIDATION_ERROR', 'Title is required', 400);
 *
 * Response shape: { error: { code, message } }
 */
export function apiError(code: ApiErrorCode, message: string, status?: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: status ?? STATUS_MAP[code] });
}

/**
 * Returns a standardized JSON success response.
 */
export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
