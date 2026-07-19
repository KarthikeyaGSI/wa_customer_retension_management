import { NextResponse } from 'next/server';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly status: number = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function toApiErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status }
    );
  }

  if (err instanceof Error) {
    return NextResponse.json(
      { error: { code: 'internal', message: err.message } },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { error: { code: 'internal', message: 'Unknown error' } },
    { status: 500 }
  );
}