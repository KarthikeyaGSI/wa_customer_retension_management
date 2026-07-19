import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'automations:write');
    const resolvedParams = await params;
    const automationId = resolvedParams.id;
    const versionId = resolvedParams.versionId;

    const db = supabaseAdmin();

    // Get version
    const { data: version, error: versionError } = await db
      .from('automation_versions')
      .select('*')
      .eq('id', versionId)
      .eq('automation_id', automationId)
      .single();

    if (versionError || !version) {
      return fail('not_found', 'Version not found', 404);
    }

    // Verify account ownership
    const { data: automation } = await db
      .from('automations')
      .select('account_id')
      .eq('id', automationId)
      .single();

    if (!automation || automation.account_id !== ctx.accountId) {
      return fail('forbidden', 'Automation not in your account', 403);
    }

    // Deactivate all current versions
    await db
      .from('automation_versions')
      .update({ is_active: false })
      .eq('automation_id', automationId);

    // Activate this version
    await db
      .from('automation_versions')
      .update({ is_active: true })
      .eq('id', versionId);

    // Rollback the main automation record
    const { error: rollbackError } = await db
      .from('automations')
      .update({
        name: version.name,
        description: version.description,
        trigger_type: version.trigger_type,
        trigger_config: version.trigger_config,
        is_active: version.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', automationId);

    if (rollbackError) {
      return fail('internal', 'Failed to rollback automation', 500);
    }

    // Delete current steps and recreate from version
    await db.from('automation_steps').delete().eq('automation_id', automationId);

    if (version.steps && version.steps.length > 0) {
      const stepsToInsert = version.steps.map((step: any, index: number) => ({
        automation_id: automationId,
        parent_step_id: step.parent_step_id ?? null,
        branch: step.branch ?? null,
        step_type: step.step_type,
        step_config: step.step_config,
        position: index,
      }));

      await db.from('automation_steps').insert(stepsToInsert);
    }

    return ok({ rolled_back_to: version.version, message: 'Automation rolled back successfully' });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}