import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { buildSendComponents, type SendTimeParams } from '@/lib/whatsapp/template-send-builder';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

    const body = await request.json().catch(() => null) as {
      template_name: string;
      template_language?: string;
      variables?: Record<string, string>;
      header_text_variables?: Record<string, string>;
      header_media_url?: string;
      button_params?: Record<string, string>;
    } | null;

    if (!body?.template_name) {
      return fail('bad_request', 'template_name is required', 400);
    }

    const db = supabaseAdmin();

    // Get template
    const { data: template, error: templateError } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('name', body.template_name)
      .eq('language', body.template_language ?? 'en_US')
      .single();

    if (templateError || !template) {
      return fail('not_found', 'Template not found', 404);
    }

    // Build components with provided variables
    const params: SendTimeParams = {
      body: body.variables ? Object.values(body.variables) : undefined,
      headerText: body.header_text_variables ? Object.values(body.header_text_variables)[0] : undefined,
      headerMediaUrl: body.header_media_url,
      buttonParams: body.button_params,
    };

    const components = buildSendComponents(template, params);

    // Return the rendered preview
    return ok({
      template_name: template.name,
      language: template.language,
      category: template.category,
      header_type: template.header_type,
      header_content: template.header_content,
      body_text: template.body_text,
      footer_text: template.footer_text,
      buttons: template.buttons,
      rendered_components: components,
      preview: {
        header: components.find(c => c.type === 'header'),
        body: components.find(c => c.type === 'body'),
        footer: template.footer_text ? { type: 'footer', text: template.footer_text } : undefined,
        buttons: components.filter(c => c.type === 'button'),
      },
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}