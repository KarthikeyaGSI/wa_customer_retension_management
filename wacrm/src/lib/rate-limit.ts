// ============================================================
// Rate Limiter — Dual-mode: Redis-backed (async) + in-memory (sync).
// ============================================================
//
// Public API:
//   - checkRateLimit(key, options) — async, Redis-backed (production)
//   - checkRateLimitSync(key, options) — sync, in-memory (dev/test/middleware)
//   - rateLimitResponse(result) — 429 helper (unchanged)
//
// Production: set REDIS_URL. Dev/test: falls back to in-memory.
// ============================================================

import { NextResponse } from 'next/server';

// ============================================================
// In-memory implementation (original, unchanged for sync use)
// ============================================================

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
  limit: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

const LIGHT_SWEEP_EVERY = 1000;
let callsSinceSweep = 0;

function sweepExpired(now: number) {
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

/** Synchronous in-memory rate limiter — for dev/test/middleware */
export function checkRateLimitSync(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();

  // Opportunistic cleanup
  callsSinceSweep += 1;
  if (callsSinceSweep >= LIGHT_SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweepExpired(now);
  }

  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1, reset: now + windowMs, limit };
  }

  if (entry.count >= limit) {
    return { success: false, remaining: 0, reset: entry.resetAt, limit };
  }

  entry.count += 1;
  return {
    success: true,
    remaining: limit - entry.count,
    reset: entry.resetAt,
    limit,
  };
}

let callsSinceSweep = 0;

function sweepExpired(now: number) {
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

// ============================================================
// Async Redis-backed rate limiter — for production endpoints
// ============================================================

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
  limit: number;
}

const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local resetAt = redis.call('GET', key .. ':reset')
if not resetAt or tonumber(resetAt) <= now then
  local resetAtNew = now + windowMs
  redis.call('SET', key, 1, 'PX', windowMs)
  redis.call('SET', key .. ':reset', resetAtNew, 'PX', windowMs)
  return {1, limit - 1, resetAtNew, limit}
end

local current = tonumber(redis.call('GET', key) or '0')
if current >= limit then
  local ttl = redis.call('PTTL', key)
  return {0, 0, tonumber(resetAt), limit}
end

local newCount = redis.call('INCR', key)
return {1, limit - newCount, tonumber(resetAt), limit}
`;

let _redis: any = null;
let _scriptLoaded = false;

async function getRedisClient() {
  if (!_redis) {
    const { getRedis } = await import('./redis');
    _redis = getRedis();
  }
  return _redis;
}

async function ensureScript(redis: any) {
  if (!_scriptLoaded) {
    try {
      await redis.script('LOAD', RATE_LIMIT_SCRIPT);
      _scriptLoaded = true;
    } catch {
      // Script might already be loaded
    }
  }
}

export async function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<{
  success: boolean;
  remaining: number;
  reset: number;
  limit: number;
}> {
  // Dev/test: skip Redis if not configured
  if (process.env.NODE_ENV !== 'production' && !process.env.REDIS_URL) {
    return fallbackCheck(key, { limit, windowMs });
  }

  try {
    const redis = await getRedisClient();
    const script = RATE_LIMIT_SCRIPT;
    await redis.script('LOAD', script);
    const sha = await redis.script('LOAD', script);
    const result = await redis.evalsha(sha, 1, key, limit.toString(), windowMs.toString(), Date.now().toString()) as [number, number, number, number];

    const [allowed, remaining, reset, limit] = result;
    return {
      success: allowed === 1,
      remaining: Math.max(0, remaining),
      reset,
      limit,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[rate-limit] Redis unavailable, falling back to in-memory:', err);
      return fallbackCheck(key, { limit, windowMs });
    }
    throw err;
  }
}

function fallbackCheck(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): { success: boolean; remaining: number; reset: number; limit: number } {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1, reset: now + windowMs, limit };
  }

  if (entry.count >= limit) {
    return { success: false, remaining: 0, reset: entry.resetAt, limit };
  }

  entry.count += 1;
  return { success: true, remaining: limit - entry.count, reset: entry.resetAt, limit };
}

// ============================================================
// Rate limit response helper (unchanged)
// ============================================================

import { NextResponse } from 'next/server';

export function rateLimitResponse(
  result: { success: boolean; remaining: number; reset: number; limit: number },
): Response {
  const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'Rate limit exceeded', retry_after_seconds: retryAfterSec },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
      },
    },
  );
}

// Preconfigured budgets
export const RATE_LIMITS = {
  send: { limit: 60, windowMs: 60_000 },
  broadcast: { limit: 5, windowMs: 60_000 },
  react: { limit: 120, windowMs: 60_000 },
  invitationPeek: { limit: 30, windowMs: 60_000 },
  invitationRedeem: { limit: 10, windowMs: 60_000 },
  adminAction: { limit: 30, windowMs: 60_000 },
  publicApi: { limit: 120, windowMs: 60_000 },
  aiDraft: { limit: 20, windowMs: 60_000 },
  aiDraftAccount: { limit: 60, windowMs: 60_000 },
} as const;

export function __resetRateLimitForTests() {
  buckets.clear();
}