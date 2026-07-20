// ============================================================
// GET /api/appointments/reminders/cron
//
// Sends a WhatsApp reminder for each upcoming, still-confirmed
// appointment whose start falls within the reminder window
// (default 24h) and which hasn't been reminded yet. Protected by
// the shared cron secret. Uses the service-role client. For each
// appointment it resolves (or creates) the contact's conversation
// and sends the reminder via the account's WhatsApp number.
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  resolveConversationByPhone,
} from '@/lib/whatsapp/resolve-conversation';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import { dispatchIntegrations } from '@/lib/integrations/notify';

export const dynamic = 'force-dynamic';

const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000; // 24h before start

function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

async function processReminders(): Promise<number> {
  const db = supabaseAdmin();
  const now = Date.now();
  const windowEnd = new Date(now + REMINDER_LEAD_MS).toISOString();

  const { data: due, error } = await db
    .from('appointments')
    .select('id, account_id, contact_id, customer_name, customer_phone, scheduled_at')
    .eq('status', 'confirmed')
    .is('reminder_sent_at', null)
    .gte('scheduled_at', new Date(now).toISOString())
    .lte('scheduled_at', windowEnd)
    .limit(100);

  if (error || !due?.length) return 0;

  let sent = 0;
  for (const appt of due) {
    try {
      const phone = appt.customer_phone;
      if (!phone) {
        // No phone to remind — mark as handled so we don't retry forever.
        await db
          .from('appointments')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', appt.id);
        continue;
      }

      const { conversationId } = await resolveConversationByPhone(
        supabaseAdmin(),
        appt.account_id,
        phone,
        appt.customer_name,
      );

      const when = new Date(appt.scheduled_at).toLocaleString();
      await sendMessageToConversation(supabaseAdmin(), appt.account_id, {
        conversationId,
        messageType: 'text',
        contentText: `Reminder: you have an appointment scheduled for ${when}. Reply to reschedule or cancel.`,
      });

      await db
        .from('appointments')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', appt.id);

      // Mirror the reminder to Slack / email if configured.
      try {
        await dispatchIntegrations({
          accountId: appt.account_id,
          text: `Appointment reminder sent to ${appt.customer_name || appt.customer_phone}: ${when}`,
          emailSubject: 'Appointment reminder',
        });
      } catch (notifyErr) {
        console.error('[appointment-reminders] notify failed', notifyErr);
      }

      sent++;
    } catch (err) {
      console.error('[appointment-reminders] failed for', appt.id, err);
    }
  }
  return sent;
}

export async function GET(request: Request): Promise<Response> {
  const expected =
    process.env.APPOINTMENT_CRON_SECRET ??
    process.env.SLA_CRON_SECRET ??
    process.env.TASK_CRON_SECRET;
  if (!expected) {
    return new Response(JSON.stringify({ error: 'not configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  const supplied = request.headers.get('x-cron-secret');
  if (supplied !== expected) return unauthorized();

  try {
    const sent = await processReminders();
    return Response.json({ ok: true, sent });
  } catch (err) {
    console.error('[appointment-reminders] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
