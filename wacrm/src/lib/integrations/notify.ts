// ============================================================
// Third-party integration delivery — Slack + Email.
//
// Both are dependency-free: Slack via its incoming-webhook URL,
// Email via the Resend HTTP API. Secrets are decrypted at send
// time from the encrypted columns in `integrations_config`.
// These are fire-and-forget helpers used by event sources
// (e.g. new appointment, new form submission) — they never throw
// to the caller. A shared `dispatchIntegrations` fans out to the
// configured channels for an account.
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';

interface IntegrationConfig {
  slack_enabled: boolean;
  slack_webhook_url: string | null; // encrypted
  email_enabled: boolean;
  email_api_key: string | null; // encrypted
  email_from: string | null;
}

async function loadConfig(
  accountId: string,
): Promise<IntegrationConfig | null> {
  const { data, error } = await supabaseAdmin()
    .from('integrations_config')
    .select('slack_enabled, slack_webhook_url, email_enabled, email_api_key, email_from')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return data as IntegrationConfig;
}

/** Post a simple message to a Slack incoming webhook. */
export async function notifySlack(
  webhookUrlEncrypted: string,
  text: string,
): Promise<boolean> {
  try {
    const url = decrypt(webhookUrlEncrypted);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch (err) {
    console.error('[notify:slack] failed:', err);
    return false;
  }
}

/** Send an email via the Resend HTTP API. */
export async function sendEmail(
  apiKeyEncrypted: string,
  from: string | null,
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  try {
    const key = decrypt(apiKeyEncrypted);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: from || 'CRM <onboarding@resend.dev>',
        to: [to],
        subject,
        text: body,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('[notify:email] failed:', err);
    return false;
  }
}

/**
 * Fan out a notification to every channel enabled for `accountId`.
 * `channels`: 'slack' and/or 'email'. `emailTo` is required when
 * email is requested. Never throws.
 */
export async function dispatchIntegrations(props: {
  accountId: string;
  text: string;
  channels?: Array<'slack' | 'email'>;
  emailTo?: string;
  emailSubject?: string;
}): Promise<void> {
  const channels = props.channels ?? ['slack', 'email'];
  const config = await loadConfig(props.accountId);
  if (!config) return;

  if (channels.includes('slack') && config.slack_enabled && config.slack_webhook_url) {
    await notifySlack(config.slack_webhook_url, props.text);
  }
  if (
    channels.includes('email') &&
    config.email_enabled &&
    config.email_api_key &&
    props.emailTo
  ) {
    await sendEmail(
      config.email_api_key,
      config.email_from,
      props.emailTo,
      props.emailSubject ?? 'Notification',
      props.text,
    );
  }
}
