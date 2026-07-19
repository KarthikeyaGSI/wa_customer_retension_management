import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Shared mock state
const h = vi.hoisted(() => ({
  state: {
    webhookEndpoints: [] as any[],
    messages: [] as any[],
    automationLogs: [] as any[],
    whatsappConfigs: [] as any[],
    accounts: [] as any[],
    pendingExecutions: [] as any[],
    flowRuns: [] as any[],
    automationSteps: [] as any[],
    incidentLogs: [] as any[],
    fromCalls: [] as string[],
    updateCalls: [] as any[],
    insertCalls: [] as any[],
  },
}));

vi.mock('@/lib/automations/admin-client', () => {
  const { state } = h;
  let currentType = 'select';
  function builder(table: string) {
    const ops = { table, payload: undefined as unknown, filters: [] as any[] };
    const b: Record<string, unknown> = {
      select: (cols?: string) => {
        currentType = 'select';
        ops.payload = cols;
        return b;
      },
      insert: (p: unknown) => {
        currentType = 'insert';
        ops.payload = p;
        state.insertCalls.push({ table, payload: p });
        return b;
      },
      update: (p: unknown) => {
        currentType = 'update';
        ops.payload = p;
        return b;
      },
      delete: () => {
        currentType = 'delete';
        return b;
      },
      eq: (k: string, v: unknown) => {
        ops.filters.push(['eq', k, v]);
        return b;
      },
      gte: (k: string, v: unknown) => {
        ops.filters.push(['gte', k, v]);
        return b;
      },
      lte: (k: string, v: unknown) => {
        ops.filters.push(['lte', k, v]);
        return b;
      },
      neq: (k: string, v: unknown) => {
        ops.filters.push(['neq', k, v]);
        return b;
      },
      is: (k: string, v: unknown) => {
        ops.filters.push(['is', k, v]);
        return b;
      },
      in: (k: string, v: unknown[]) => {
        ops.filters.push(['in', k, v]);
        return b;
      },
      ilike: (k: string, v: unknown) => {
        ops.filters.push(['ilike', k, v]);
        return b;
      },
      not: (k: string, op: string, v: unknown) => {
        ops.filters.push(['not', k, op, v]);
        return b;
      },
      order: () => b,
      limit: () => b,
      single: () => {
        state.fromCalls.push(table);
        // single returns first row or throws if not exactly one
        const result = resolveQuery(ops);
        const data = Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;
        return Promise.resolve({ data, error: result.error });
      },
      maybeSingle: () => {
        state.fromCalls.push(table);
        const result = resolveQuery(ops);
        // maybeSingle returns first row or null
        const data = Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;
        return Promise.resolve({ data, error: result.error });
      },
      then: (onF: (v: unknown) => unknown) =>
        Promise.resolve(resolveQuery(ops)).then(onF),
    };
    return b;
  }

  function resolveQuery(ops: any) {
    const { table, filters } = ops;
    const type = currentType;
    if (table === 'webhook_endpoints') {
      if (type === 'select') {
        let rows = [...state.webhookEndpoints];
        for (const [op, key, val] of filters) {
          if (op === 'eq') rows = rows.filter((r) => r[key] === val);
          if (op === 'gte') rows = rows.filter((r) => (r[key] ?? 0) >= val);
          if (op === 'is') rows = rows.filter((r) => r[key] === val);
        }
        return { data: rows, error: null };
      }
      if (type === 'update') {
        const id = filters.find((f: any) => f[1] === 'id')?.[2];
        const idx = state.webhookEndpoints.findIndex((r) => r.id === id);
        if (idx >= 0) state.webhookEndpoints[idx] = { ...state.webhookEndpoints[idx], ...ops.payload };
        state.updateCalls.push({ table, filters, payload: ops.payload });
        return { data: null, error: null };
      }
    }
    if (table === 'messages') {
      if (type === 'select') {
        let rows = [...state.messages];
        for (const [op, key, val] of filters) {
          if (op === 'eq') rows = rows.filter((r) => r[key] === val);
          if (op === 'gte') rows = rows.filter((r) => (r[key] ?? '') >= val);
        }
        return { data: rows, error: null };
      }
    }
    if (table === 'automation_logs') {
      if (type === 'select') {
        let rows = [...state.automationLogs];
        for (const [op, key, val] of filters) {
          if (op === 'eq') rows = rows.filter((r) => r[key] === val);
          if (op === 'gte') rows = rows.filter((r) => (r[key] ?? '') >= val);
          if (op === 'ilike') {
            const pattern = (val as string).replace('%', '');
            rows = rows.filter((r) => (r[key] ?? '').toLowerCase().includes(pattern.toLowerCase()));
          }
        }
        // Handle order and limit
        // For simplicity, we just return all matching rows
        return { data: rows, error: null };
      }
    }
    if (table === 'whatsapp_config') {
      if (type === 'select') {
        let rows = [...state.whatsappConfigs];
        for (const [op, key, val] of filters) {
          if (op === 'eq') rows = rows.filter((r) => r[key] === val);
        }
        return { data: rows, error: null };
      }
    }
    if (table === 'accounts') {
      if (type === 'select') {
        let rows = [...state.accounts];
        for (const [op, key, val] of filters) {
          if (op === 'not') {
            // Simplified: in ('SELECT ...') - just return all for test
          }
        }
        return { data: rows, error: null };
      }
    }
    if (table === 'automation_pending_executions') {
      if (type === 'select') {
        let rows = [...state.pendingExecutions];
        for (const [op, key, val] of filters) {
          if (op === 'eq') rows = rows.filter((r) => r[key] === val);
          if (op === 'lte') rows = rows.filter((r) => (r[key] ?? '') <= val);
        }
        return { data: rows, error: null };
      }
      if (type === 'update') {
        const id = filters.find((f: any) => f[1] === 'id')?.[2];
        const idx = state.pendingExecutions.findIndex((r) => r.id === id);
        if (idx >= 0) state.pendingExecutions[idx] = { ...state.pendingExecutions[idx], ...ops.payload };
        state.updateCalls.push({ table, filters, payload: ops.payload });
        return { data: null, error: null };
      }
    }
    if (table === 'flow_runs') {
      if (type === 'select') {
        let rows = [...state.flowRuns];
        for (const [op, key, val] of filters) {
          if (op === 'eq') rows = rows.filter((r) => r[key] === val);
          if (op === 'lte') rows = rows.filter((r) => (r[key] ?? '') <= val);
        }
        return { data: rows, error: null };
      }
    }
    if (table === 'automation_steps') {
      if (type === 'select') {
        let rows = [...state.automationSteps];
        for (const [op, key, val] of filters) {
          if (op === 'eq') rows = rows.filter((r) => r[key] === val);
          if (op === 'gte') rows = rows.filter((r) => (r[key] ?? 0) >= val);
        }
        return { data: rows, error: null };
      }
    }
    if (table === 'incident_logs') {
      if (type === 'insert') {
        state.incidentLogs.push(ops.payload);
        return { data: { id: 'inc-' + state.incidentLogs.length }, error: null };
      }
    }
    return { data: null, error: null };
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => builder(t),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  };
});

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => {
    if (s === 'corrupted-token') throw new Error('Decrypt failed');
    return s;
  },
  encrypt: (s: string) => s,
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.test' })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid.test' })),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.test' })),
}));

vi.mock('node:fetch', () => ({
  default: vi.fn(),
}));

import { detectAllIssues } from '@/lib/support-agent/detect';
import { diagnoseIssue } from '@/lib/support-agent/diagnose';
import { executeFix } from '@/lib/support-agent/fix';
import { supabaseAdmin } from '@/lib/automations/admin-client';

const ACCOUNT = 'acct-1';
const ENDPOINT_ID = 'ep-1';
const ENDPOINT_URL = 'https://example.com/hook';

beforeEach(() => {
  h.state.webhookEndpoints = [];
  h.state.messages = [];
  h.state.automationLogs = [];
  h.state.whatsappConfigs = [];
  h.state.accounts = [{ id: ACCOUNT, name: 'Test Account' }];
  h.state.pendingExecutions = [];
  h.state.flowRuns = [];
  h.state.automationSteps = [];
  h.state.incidentLogs = [];
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.insertCalls = [];

  // Mock fetch globally
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectAllIssues', () => {
  it('detects disabled webhook endpoints above failure threshold', async () => {
    h.state.webhookEndpoints = [
      {
        id: ENDPOINT_ID,
        account_id: ACCOUNT,
        url: ENDPOINT_URL,
        is_active: false,
        failure_count: 15,
        last_delivery_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const results = await detectAllIssues();
    const disabled = results.find((r) => r.incidentType === 'webhook_endpoint_disabled');
    expect(disabled).toBeDefined();
    expect(disabled?.accountId).toBe(ACCOUNT);
    expect(disabled?.payload.endpoint_id).toBe(ENDPOINT_ID);
  });

  it('detects failing webhook endpoints approaching threshold', async () => {
    h.state.webhookEndpoints = [
      {
        id: 'ep-2',
        account_id: ACCOUNT,
        url: 'https://example.com/hook2',
        is_active: true,
        failure_count: 12,
        last_delivery_at: new Date().toISOString(),
      },
    ];

    const results = await detectAllIssues();
    const failing = results.find((r) => r.incidentType === 'webhook_delivery_failing');
    expect(failing).toBeDefined();
    expect(failing?.payload.failure_count).toBe(12);
  });

  it('detects multiple failed message sends', async () => {
    const now = new Date().toISOString();
    h.state.messages = [
      { id: 'm1', account_id: ACCOUNT, conversation_id: 'c1', contact_id: 'ct1', status: 'failed', content_type: 'text', created_at: now },
      { id: 'm2', account_id: ACCOUNT, conversation_id: 'c1', contact_id: 'ct1', status: 'failed', content_type: 'text', created_at: now },
      { id: 'm3', account_id: ACCOUNT, conversation_id: 'c1', contact_id: 'ct1', status: 'failed', content_type: 'text', created_at: now },
    ];
    h.state.whatsappConfigs = [{ id: 'wc1', account_id: ACCOUNT, phone_number_id: 'pni1', status: 'connected' }];

    const results = await detectAllIssues();
    const failed = results.find((r) => r.incidentType === 'message_send_failed');
    expect(failed).toBeDefined();
    expect(failed?.payload.failure_count).toBe(3);
  });

  it.skip('detects Meta API errors in automation logs', async () => {
    h.state.automationLogs = [
      { id: 'l1', account_id: ACCOUNT, status: 'failed', error_message: 'Meta error (#131009)', created_at: new Date().toISOString() },
      { id: 'l2', account_id: ACCOUNT, status: 'failed', error_message: 'Meta error (#131009)', created_at: new Date().toISOString() },
    ];

    const results = await detectAllIssues();
    const metaErr = results.find((r) => r.incidentType === 'meta_api_error');
    expect(metaErr).toBeDefined();
    expect(metaErr?.payload.error_codes).toContain('131009');
  });

  it('detects accounts without WhatsApp config', async () => {
    h.state.accounts = [{ id: 'acct-2', name: 'No Config Account' }];
    h.state.whatsappConfigs = [{ id: 'wc1', account_id: ACCOUNT }];

    const results = await detectAllIssues();
    const unconfigured = results.find((r) => r.incidentType === 'whatsapp_not_configured');
    expect(unconfigured).toBeDefined();
    expect(unconfigured?.accountId).toBe('acct-2');
  });

  it('detects undecryptable WhatsApp config tokens', async () => {
    h.state.whatsappConfigs = [
      { id: 'wc-bad', account_id: ACCOUNT, access_token: 'corrupted-token' },
    ];

    const results = await detectAllIssues();
    const decryptErr = results.find((r) => r.incidentType === 'meta_api_error' && r.payload.error_code === 'decrypt_failed');
    expect(decryptErr).toBeDefined();
  });

  it('detects cron not firing via overdue pending executions', async () => {
    const stale = new Date(Date.now() - 400 * 1000).toISOString(); // >5 min
    h.state.pendingExecutions = [
      { id: 'pe1', account_id: ACCOUNT, automation_id: 'a1', run_at: stale, status: 'pending', created_at: new Date().toISOString() },
      { id: 'pe2', account_id: ACCOUNT, automation_id: 'a1', run_at: stale, status: 'pending', created_at: new Date().toISOString() },
    ];

    const results = await detectAllIssues();
    const cronIssue = results.find((r) => r.incidentType === 'cron_not_firing');
    expect(cronIssue).toBeDefined();
    expect(cronIssue?.payload.pending_count).toBe(2);
  });

  it('detects stuck automation executions', async () => {
    const stuckTime = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 min ago
    h.state.pendingExecutions = [
      { id: 'pe-stuck', account_id: ACCOUNT, automation_id: 'a1', status: 'running', created_at: stuckTime, next_step_position: 2 },
    ];

    const results = await detectAllIssues();
    const stuck = results.find((r) => r.incidentType === 'automation_stuck');
    expect(stuck).toBeDefined();
    expect(stuck?.payload.pending_execution_id).toBe('pe-stuck');
  });

  it('detects stalled flow runs exceeding fallback timeout', async () => {
    const stuckTime = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(); // 30h ago
    h.state.flowRuns = [
      {
        id: 'fr1',
        account_id: ACCOUNT,
        flow_id: 'f1',
        contact_id: 'ct1',
        status: 'active',
        last_advanced_at: stuckTime,
        flows: [{ fallback_policy: { on_timeout_hours: 24 } }],
      },
    ];

    const results = await detectAllIssues();
    const stalled = results.find((r) => r.incidentType === 'flow_run_stalled');
    expect(stalled).toBeDefined();
    expect(stalled?.payload.flow_run_id).toBe('fr1');
  });
});

describe('diagnoseIssue', () => {
  it('diagnoses disabled webhook as external if unreachable', async () => {
    const db = supabaseAdmin();
    vi.mocked(fetch).mockRejectedValue(new Error('ENOTFOUND'));

    const event = {
      incidentType: 'webhook_delivery_failing' as const,
      accountId: ACCOUNT,
      summary: 'test',
      payload: { endpoint_id: ENDPOINT_ID, endpoint_url: 'https://bad.example.com/hook', failure_count: 12 },
      detectedAt: new Date().toISOString(),
    };

    const result = await diagnoseIssue(db, event);
    expect(result.category).toBe('external');
    expect(result.severity).toBe('high');
    expect(result.recommendedAction).toBe('human_review');
  });

  it.skip('diagnoses message send failure with expired token as config issue', async () => {
    const db = supabaseAdmin();
    h.state.messages = [{ id: 'm1', account_id: ACCOUNT, status: 'failed' }];
    h.state.whatsappConfigs = [{ id: 'wc1', account_id: ACCOUNT, phone_number_id: 'pni1', status: 'connected' }];
    h.state.automationLogs = [
      { id: 'l1', account_id: ACCOUNT, error_message: 'Meta error (#190)', status: 'failed', created_at: new Date().toISOString() },
    ];

    const event = {
      incidentType: 'message_send_failed' as const,
      accountId: ACCOUNT,
      summary: 'test',
      payload: { message_id: 'm1', failure_count: 3 },
      detectedAt: new Date().toISOString(),
    };

    const result = await diagnoseIssue(db, event);
    expect(result.rootCause).toContain('token expired');
    expect(result.category).toBe('config');
    expect(result.severity).toBe('critical');
    expect(result.recommendedAction).toBe('human_review');
  });

  it.skip('diagnoses rate limit as auto-fixable', async () => {
    const db = supabaseAdmin();
    h.state.messages = [{ id: 'm1', account_id: ACCOUNT, status: 'failed' }];
    h.state.whatsappConfigs = [{ id: 'wc1', account_id: ACCOUNT, phone_number_id: 'pni1', status: 'connected' }];
    h.state.automationLogs = [
      { id: 'l1', account_id: ACCOUNT, error_message: 'Meta error (#131009)', status: 'failed', created_at: new Date().toISOString() },
    ];

    const event = {
      incidentType: 'message_send_failed' as const,
      accountId: ACCOUNT,
      summary: 'test',
      payload: { message_id: 'm1', failure_count: 3 },
      detectedAt: new Date().toISOString(),
    };

    const result = await diagnoseIssue(db, event);
    expect(result.recommendedAction).toBe('auto_fix');
    expect(result.fixDetails?.type).toBe('retry_send');
  });
});

describe('executeFix - reenable_webhook', () => {
  it('re-enables a disabled endpoint after health check passes', async () => {
    const db = supabaseAdmin();
    h.state.webhookEndpoints = [
      { id: ENDPOINT_ID, account_id: ACCOUNT, url: 'https://healthy.example.com/hook', is_active: false, failure_count: 15 },
    ];
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await executeFix(db, { type: 'reenable_webhook', targetId: ENDPOINT_ID });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('reenable_webhook');
    expect(h.state.webhookEndpoints[0].is_active).toBe(true);
    expect(h.state.webhookEndpoints[0].failure_count).toBe(0);
  });

  it('refuses to re-enable if health check fails', async () => {
    const db = supabaseAdmin();
    h.state.webhookEndpoints = [
      { id: ENDPOINT_ID, account_id: ACCOUNT, url: 'https://down.example.com/hook', is_active: false, failure_count: 15 },
    ];
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await executeFix(db, { type: 'reenable_webhook', targetId: ENDPOINT_ID });

    expect(result.success).toBe(false);
    expect(h.state.webhookEndpoints[0].is_active).toBe(false);
  });

  it('refuses to re-enable already active endpoint', async () => {
    const db = supabaseAdmin();
    h.state.webhookEndpoints = [
      { id: ENDPOINT_ID, account_id: ACCOUNT, url: 'https://example.com/hook', is_active: true, failure_count: 0 },
    ];

    const result = await executeFix(db, { type: 'reenable_webhook', targetId: ENDPOINT_ID });
    expect(result.success).toBe(false);
    expect(result.error).toContain('already active');
  });
});

describe('executeFix - restart_pending_execution', () => {
  it('resets a stuck running execution to pending', async () => {
    const db = supabaseAdmin();
    h.state.pendingExecutions = [
      { id: 'pe-stuck', account_id: ACCOUNT, automation_id: 'a1', status: 'running', next_step_position: 2 },
    ];

    const result = await executeFix(db, { type: 'restart_pending_execution', targetId: 'pe-stuck' });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('restart_pending_execution');
    expect(h.state.pendingExecutions[0].status).toBe('pending');
  });

  it('refuses if execution is not in running state', async () => {
    const db = supabaseAdmin();
    h.state.pendingExecutions = [
      { id: 'pe-pending', account_id: ACCOUNT, automation_id: 'a1', status: 'pending', next_step_position: 0 },
    ];

    const result = await executeFix(db, { type: 'restart_pending_execution', targetId: 'pe-pending' });
    expect(result.success).toBe(false);
    expect(result.error).toContain("status is pending");
  });
});