import { supabaseAdmin } from '@/lib/automations/admin-client';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { loadAiConfig } from '@/lib/ai/config';
import { buildConversationContext } from '@/lib/ai/context';
import { generateReply } from '@/lib/ai/generate';

export async function summarizeConversation(
  conversationId: string,
  maxMessages: number = 50
): Promise<{ summary: string; keyPoints: string[]; sentiment: 'positive' | 'neutral' | 'negative' } | null> {
  const db = supabaseAdmin();

  const { data: messages } = await db
    .from('messages')
    .select('id, sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(maxMessages);

  if (!messages?.length) return null;

  // Format conversation for summarization
  const transcript = messages.map(m =>
    `${m.sender_type === 'customer' ? 'Customer' : 'Agent'}: ${m.content_text}`
  ).join('\n');

  const prompt = `Summarize this WhatsApp conversation in 3-5 sentences. Also extract 3-5 key points and determine overall sentiment (positive/neutral/negative).

Conversation:
${transcript}

Format your response as JSON:
{
  "summary": "string",
  "keyPoints": ["string", ...],
  "sentiment": "positive|neutral|negative"
}`;

  try {
    // Use the existing AI config for the account
    const { data: conv } = await supabaseAdmin()
      .from('conversations')
      .select('account_id')
      .eq('id', conversationId)
      .single();

    if (!conv) return null;

    const config = await loadAiConfig(supabaseAdmin(), conv.account_id);
    if (!config) return null;

    const systemPrompt = `You are a helpful assistant that summarizes customer support conversations. Be concise and accurate.`;
    
    const { text } = await generateReply({
      config,
      systemPrompt,
      messages: [
        { role: 'user', content: prompt }
      ],
    });

    // Parse JSON from AI response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary ?? '',
        keyPoints: parsed.keyPoints ?? [],
        sentiment: parsed.sentiment ?? 'neutral',
      };
    }

    return null;
  } catch (err) {
    console.error('[ai-summarize] Failed:', err);
    return null;
  }
}

// Cron endpoint to generate summaries for active conversations
export async function GET(request: Request): Promise<Response> {
  const expected = process.env.AI_SUMMARIZE_CRON_SECRET;
  if (!expected) {
    return new Response(JSON.stringify({ error: 'not configured' }), { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret');
  if (supplied !== expected) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const db = supabaseAdmin();

    // Find active conversations without recent summaries
    const { data: conversations } = await supabaseAdmin()
      .from('conversations')
      .select('id, account_id, updated_at')
      .eq('status', 'open')
      .gte('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('updated_at', { ascending: false })
      .limit(100);

    if (!conversations?.length) {
      return Response.json({ summarized: 0 });
    }

    let summarized = 0;
    for (const conv of conversations) {
      const summary = await summarizeConversation(conv.id);
      if (summary) {
        await supabaseAdmin().from('conversations').update({
          summary: summary.summary,
          summary_key_points: summary.keyPoints,
          summary_sentiment: summary.sentiment,
          summary_updated_at: new Date().toISOString(),
        }).eq('id', conv.id);
        summarized++;
      }
    }

    return Response.json({ summarized });
  } catch (err) {
    console.error('[ai-summarize-cron] Error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}