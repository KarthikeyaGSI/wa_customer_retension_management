import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseContactCsv } from '@/lib/contacts/parse-contact-csv';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('text/csv') && !contentType.includes('multipart/form-data')) {
      return fail('bad_request', 'Content-Type must be text/csv or multipart/form-data', 400);
    }

    let csvText: string;
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file || typeof file === 'string') {
        return fail('bad_request', 'Missing file in multipart/form-data', 400);
      }
      csvText = await file.text();
    } else {
      csvText = await request.text();
    }

    const { rows, hasTagsColumn, hasCompanyColumn } = parseContactCsv(csvText);
    if (rows.length === 0) {
      return fail('bad_request', 'No valid contacts found in CSV', 400);
    }

    const db = supabaseAdmin();

    // Upsert contacts in batches
    const batchSize = 100;
    let created = 0;
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { data, error } = await db
        .from('contacts')
        .upsert(
          batch.map(c => ({
            account_id: ctx.accountId,
            user_id: ctx.createdBy,
            phone: c.phone,
            name: c.name ?? c.phone,
            email: c.email ?? null,
            company: c.company ?? null,
          })),
          { onConflict: 'account_id,phone', ignoreDuplicates: false }
        )
        .select('id');

      if (error) {
        failed += batch.length;
        console.error('[import] batch upsert error:', error);
      } else {
        // Can't easily distinguish created vs updated with upsert
        // For simplicity, count all as created
        created += data?.length ?? batch.length;
      }
    }

    return ok({
      processed: rows.length,
      created,
      updated,
      failed,
      hasTagsColumn,
      hasCompanyColumn,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}