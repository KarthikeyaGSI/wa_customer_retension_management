import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');

    const body = await request.json().catch(() => null) as {
      template_id: string;
      to: string;
      language?: string;
      variables?: Record<string, string>;
    } | null;

    if (!body?.template_id || !body.to) {
      return fail('bad_request', 'template_id and to required', 400);
    }

    const db = supabaseAdmin();

    // Get template
    const { data: template, error: templateError } = await db
      .from('message_templates')
      .select('*')
      .eq('id', body.template_id)
      .eq('account_id', ctx.accountId)
      .single();

    if (templateError || !template) {
      return fail('not_found', 'Template not found', 404);
    }

    if (template.status !== 'APPROVED') {
      return fail('bad_request', 'Template must be approved to send', 400);
    }

    // Get WhatsApp config
    const { data: config } = await db
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', ctx.accountId)
      .single();

    if (!config) {
      return fail('bad_request', 'WhatsApp not configured', 400);
    }

    const accessToken = decrypt(config.access_token);

    // Send test message
    const result = await sendTemplateMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: body.to,
      templateName: template.name,
      language: body.language ?? template.language ?? 'en_US',
      params: body.variables
        ? Object.values(body.variables).map(v => String(v))
        : [],
    });

    return ok({
      test_sent: true,
      whatsapp_message_id: result.messageId,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}