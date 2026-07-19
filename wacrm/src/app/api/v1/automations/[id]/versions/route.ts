import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'automations:write');
    const resolvedParams = await params;
    const automationId = resolvedParams.id;

    const body = await request.json().catch(() => null) as { change_summary?: string } | null;
    const changeSummary = body?.change_summary ?? 'Manual version';

    const db = supabaseAdmin();

    // Get current automation
    const { data: automation, error: fetchError } = await db
      .from('automations')
      .select('*')
      .eq('id', automationId)
      .eq('account_id', ctx.accountId)
      .single();

    if (fetchError || !automation) {
      return fail('not_found', 'Automation not found', 404);
    }

    // Get current steps
    const { data: steps } = await db
      .from('automation_steps')
      .select('*')
      .eq('automation_id', automationId)
      .order('position', { ascending: true });

    // Get next version number
    const { data: versions } = await db
      .from('automation_versions')
      .select('version')
      .eq('automation_id', automationId)
      .order('version', { ascending: false })
      .limit(1);

    const nextVersion = (versions?.[0]?.version ?? 0) + 1;

    // Create version
    const { data: version, error: versionError } = await db
      .from('automation_versions')
      .insert({
        automation_id: automationId,
        version: nextVersion,
        name: automation.name,
        description: automation.description,
        trigger_type: automation.trigger_type,
        trigger_config: automation.trigger_config,
        steps: steps ?? [],
        is_active: automation.is_active,
        created_by: ctx.createdBy,
        change_summary: changeSummary,
      })
      .select()
      .single();

    if (versionError) {
      return fail('internal', 'Failed to create version', 500);
    }

    return ok(version, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'automations:read');
    const resolvedParams = await params;
    const automationId = resolvedParams.id;

    const db = supabaseAdmin();

    const { data, error } = await db
      .from('automation_versions')
      .select('*')
      .eq('automation_id', automationId)
      .eq('automations.account_id', ctx.accountId)
      .order('version', { ascending: false });

    if (error) {
      return toApiErrorResponse(error);
    }

    return ok({ data: data ?? [] });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}