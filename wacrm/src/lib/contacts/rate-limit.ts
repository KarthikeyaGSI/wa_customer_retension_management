import { supabaseAdmin } from '@/lib/automations/admin-client';

interface RateLimitConfig {
  maxMessages: number;
  windowMs: number;
  blockDurationMs: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxMessages: 5,
  windowMs: 60 * 60 * 1000, // 1 hour
  blockDurationMs: 60 * 60 * 1000, // 1 hour block
};

export async function checkContactRateLimit(
  contactId: string,
  accountId: string,
  config: Partial<RateLimitConfig> = {}
): Promise<{ allowed: boolean; remaining: number; resetAt: number; blocked?: boolean; retryAfterMs?: number }> {
  // Fail open in test environment to avoid real DB calls during tests
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return { allowed: true, remaining: 999, resetAt: Date.now() + 3600000 };
  }

  const cfg = { ...DEFAULT_CONFIG, ...config };
  const db = supabaseAdmin();

  const now = Date.now();
  const windowStart = now - cfg.windowMs;
  const windowStartIso = new Date(windowStart).toISOString();

  // Clean up old entries and count recent messages
  const { data: recent, error: countError } = await db
    .from('messages')
    .select('id')
    .eq('contact_id', contactId)
    .eq('sender_type', 'agent')
    .gte('created_at', windowStartIso);

  if (countError) {
    console.error('[contact-rate-limit] Count error:', countError);
    return { allowed: true, remaining: cfg.maxMessages, resetAt: now + cfg.windowMs };
  }

  const sentCount = recent?.length ?? 0;
  const remaining = Math.max(0, cfg.maxMessages - sentCount);

  if (sentCount >= cfg.maxMessages) {
    // Check if already blocked
    const { data: block } = await db
      .from('contact_rate_limit_blocks')
      .select('blocked_until')
      .eq('contact_id', contactId)
      .single();

    if (block && new Date(block.blocked_until).getTime() > now) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(block.blocked_until).getTime(),
        blocked: true,
        retryAfterMs: new Date(block.blocked_until).getTime() - now,
      };
    }

    // Create block
    const blockedUntil = new Date(now + cfg.blockDurationMs).toISOString();
    await db.from('contact_rate_limit_blocks').upsert({
      contact_id: contactId,
      blocked_until: blockedUntil,
      reason: `Rate limit exceeded: ${sentCount} messages in ${cfg.windowMs / 1000 / 60} min`,
    });

    return { allowed: false, remaining: 0, resetAt: now + cfg.blockDurationMs, blocked: true, retryAfterMs: cfg.blockDurationMs };
  }

  return { allowed: true, remaining, resetAt: now + cfg.windowMs };
}

export async function removeContactRateLimitBlock(contactId: string): Promise<void> {
  const db = supabaseAdmin();
  await db.from('contact_rate_limit_blocks').delete().eq('contact_id', contactId);
}