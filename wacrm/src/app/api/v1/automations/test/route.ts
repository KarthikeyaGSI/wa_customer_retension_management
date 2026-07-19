import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import type { AutomationTriggerType } from '@/types';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'automations:write');

    const body = await request.json().catch(() => null) as {
      automation_id: string;
      trigger_type: AutomationTriggerType;
      contact_id?: string;
      context?: Record<string, unknown>;
    } | null;

    if (!body?.automation_id || !body?.trigger_type) {
      return fail('bad_request', 'automation_id and trigger_type required', 400);
    }

    const db = supabaseAdmin();

    // Verify automation belongs to account
    const { data: automation, error } = await db
      .from('automations')
      .select('id, account_id, is_active')
      .eq('id', body.automation_id)
      .eq('account_id', ctx.accountId)
      .single();

    if (error || !automation) {
      return fail('not_found', 'Automation not found', 404);
    }

    if (!automation.is_active) {
      return fail('bad_request', 'Automation is not active', 400);
    }

    // Run the automation
    await runAutomationsForTrigger({
      accountId: ctx.accountId,
      triggerType: body.trigger_type,
      contactId: body.contact_id ?? null,
      context: body.context ?? {},
    });

    return ok({ test_triggered: true, automation_id: body.automation_id });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}