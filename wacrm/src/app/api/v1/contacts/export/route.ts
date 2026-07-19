import { requireApiKey } from '@/lib/auth/api-context';
import { toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { NextResponse } from 'next/server';

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function contactsToCsv(contacts: any[]): string {
  const headers = ['phone', 'name', 'email', 'company', 'tags', 'created_at', 'updated_at'];
  const rows = contacts.map(c => [
    escapeCsv(c.phone),
    escapeCsv(c.name ?? ''),
    escapeCsv(c.email ?? ''),
    escapeCsv(c.company ?? ''),
    escapeCsv((c.tags ?? []).map((t: any) => t.name).join(';')),
    escapeCsv(c.created_at),
    escapeCsv(c.updated_at),
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');

    const { searchParams } = new URL(request.url);
    const tag = searchParams.get('tag');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '10000', 10), 10000);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const db = supabaseAdmin();

    let query = db
      .from('contacts')
      .select('id, phone, name, email, company, created_at, updated_at, tags:contact_tags(tags(id,name))')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (tag) {
      query = query.filter('tags.tags.name', 'eq', tag);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 });
    }

    const csv = contactsToCsv(data ?? []);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="contacts-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}