---
name: marketingko-wa-crm-support-agent
description: |
  Operational knowledge for the Marketing ko WA CRM codebase: folder layout, webhook/
  automation/cron architecture, outbound webhook signing/verification, and
  the autonomous "WA net support" agent's detect/diagnose/fix/flag boundaries.
---

# Marketing ko WA CRM Support Agent — Operational Skill

This document captures the "tribal knowledge" needed to operate, debug, and
extend the Marketing ko WA CRM platform. It is intended for future agent sessions (and
human operators) so they don't have to rediscover conventions by reading
every file.

---

## 1. Folder Layout & Key Entry Points

```
wacrm/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── whatsapp/webhook/route.ts      # Inbound Meta webhook (GET verify, POST receive)
│   │   │   ├── v1/webhooks/route.ts            # Outbound webhook CRUD (POST returns secret once)
│   │   │   ├── v1/webhooks/[id]/route.ts       # PATCH (re-enable clears failure_count) / DELETE
│   │   │   ├── v1/messages/route.ts            # Public API: send message
│   │   │   ├── automations/cron/route.ts       # Drains automation_pending_executions (Wait steps)
│   │   │   ├── automations/engine/route.ts     # Manual trigger for testing automations
│   │   │   ├── support-agent/cron/route.ts     # ← NEW: Periodic support agent runner
│   │   │   └── flows/cron/route.ts             # Sweeps stale flow_runs (fallback timeout)
│   │   └── ...
│   ├── lib/
│   │   ├── webhooks/
│   │   │   ├── deliver.ts          # dispatchWebhookEvent — signs & POSTs to endpoints
│   │   │   ├── sign.ts             # buildSignatureHeader / verifySignatureHeader
│   │   │   ├── events.ts           # WEBHOOK_EVENTS vocabulary
│   │   │   ├── endpoints.ts        # secret generation, serialization
│   │   │   └── ssrf.ts             # isDeliverableUrl (SSRF guard)
│   │   ├── automations/
│   │   │   ├── engine.ts           # runAutomationsForTrigger + resumePendingExecution
│   │   │   ├── meta-send.ts        # Low-level send_message / send_template for engine
│   │   │   └── admin-client.ts     # Shared service-role Supabase client
│   │   ├── whatsapp/
│   │   │   ├── send-message.ts     # Core send logic (dashboard + public API)
│   │   │   ├── meta-api.ts         # All Meta Cloud API calls
│   │   │   ├── webhook-signature.ts# verifyMetaWebhookSignature (HMAC-SHA256)
│   │   │   └── encryption.ts       # AES-256-GCM encrypt/decrypt for secrets
│   │   └── support-agent/          # ← NEW: Autonomous monitoring agent
│   │       ├── index.ts            # Orchestrator: detect → diagnose → fix → flag
│   │       ├── detect.ts           # Scans DB for known failure signatures
│   │       ├── diagnose.ts         # Runs checklists → rootCause + fixDetails
│   │       ├── fix.ts              # Safe, reversible actions (whitelisted only)
│   │       ├── log.ts              # Writes to incident_logs (audit trail)
│   │       └── types.ts            # Shared TypeScript types
│   └── ...
├── supabase/migrations/
│   ├── 028_webhook_endpoints.sql   # Outbound webhook table + record_webhook_failure RPC
│   ├── 006_automations.sql         # automations, automation_steps, automation_logs, automation_pending_executions
│   ├── 032_incident_logs.sql       # ← NEW: Support agent incident log
│   └── ...
└── docs/
    └── public-api.md               # Public API + webhook reference
```

---

## 2. Automation Flow Engine (Trigger → Steps → Wait → Cron Resume)

**Trigger types** (`src/types/index.ts:AutomationTriggerType`):
- `new_message_received` — any inbound customer message
- `first_inbound_message` — contact's first ever message
- `keyword_match` — message contains configured keyword(s)
- `new_contact_created` — contact row created (webhook or manual)
- `conversation_assigned` — agent assigned in UI
- `tag_added` — specific tag added to contact
- `time_based` — cron schedule (evaluated separately)

**Step types** (`AutomationStepType`):
- `send_message` / `send_template` — outbound via Meta
- `add_tag` / `remove_tag` — contact tagging
- `assign_conversation` — round-robin or specific agent
- `update_contact_field` — built-in or custom field
- `create_deal` — pipeline deal creation
- `wait` — **suspension point**; inserts into `automation_pending_executions`
- `condition` — branches to `yes`/`no` child steps
- `send_webhook` — arbitrary HTTP POST (no signing, caller supplies headers)
- `close_conversation` — sets status = closed

**Execution flow** (`src/lib/automations/engine.ts`):
1. `runAutomationsForTrigger` fetches active automations matching trigger.
2. For each, creates `automation_logs` row, then `executeStepsFrom`.
3. Steps run sequentially. On `wait`:
   - Compute `run_at = now + waitMs`
   - Insert `automation_pending_executions` row with `status='pending'`
   - Return `partial` status; cron will resume later.
4. On `condition`: evaluate → recurse into chosen branch.
5. On error: mark log `failed`, stop.
6. On completion: mark log `success`/`partial`, increment `execution_count` via RPC.

**Cron resume** (`src/app/api/automations/cron/route.ts`):
- Runs on schedule (Vercel Cron → `GET /api/automations/cron` with `x-cron-secret`).
- Selects `pending` rows where `run_at <= now()`, claims with `status='running'` update.
- Calls `resumePendingExecution` which loads automation + context, continues from `next_step_position`.

---

## 3. Outbound Webhooks — Signing, Verification, Auto-Disable

**Registration** (`POST /api/v1/webhooks`):
- Requires `webhooks:manage` scope.
- Generates `whsec_` + 32 random bytes (base64url).
- Stores AES-256-GCM encrypted in `webhook_endpoints.secret`.
- Returns plaintext secret **once** in 201 response.

**Delivery** (`src/lib/webhooks/deliver.ts:dispatchWebhookEvent`):
- Called from inbound webhook `after()` block (fire-and-forget).
- Queries active endpoints subscribed to event.
- Builds payload: `{ id, event, occurred_at, account_id, data }`.
- Signs: `t=<unix_sec>,v1=HMAC_SHA256(secret, "${t}.${rawBody}")`.
- Header: `X-Wacrm-Signature: t=...,v1=...`
- POSTs with 5s timeout, `redirect: 'manual'` (SSRF guard).
- **Never throws** — errors logged, `failure_count` incremented via RPC.

**Auto-disable** (`supabase/migrations/028_webhook_endpoints.sql`):
- `record_webhook_failure(endpoint_id, max_failures)` RPC does atomic:
  ```sql
  UPDATE webhook_endpoints
  SET failure_count = failure_count + 1,
      is_active = CASE WHEN failure_count + 1 >= max_failures THEN false ELSE is_active END
  WHERE id = endpoint_id;
  ```
- Threshold: **15 consecutive failures** (`MAX_CONSECUTIVE_FAILURES` in deliver.ts).
- Success resets `failure_count = 0`, stamps `last_delivery_at`.
- Re-enable via `PATCH /api/v1/webhooks/{id}` with `is_active: true` → also resets counter.

**Verification** (receiver side):
```js
const [, t, v1] = header.match(/t=(\d+),v1=([0-9a-f]+)/);
const expected = crypto.createHmac('sha256', secret)
  .update(`${t}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
// Also check |now - t| < 300s (replay protection)
```

---

## 4. Inbound WhatsApp Webhook — Verification & Processing

**GET `/api/whatsapp/webhook`** (Meta subscription verification):
- Reads `hub.mode=subscribe`, `hub.challenge`, `hub.verify_token`.
- Fetches all `whatsapp_config` rows, decrypts `verify_token`, matches.
- Returns `challenge` as plain text on match.

**POST `/api/whatsapp/webhook`** (inbound messages/statuses):
- Reads raw body, verifies `x-hub-signature-256` via `verifyMetaWebhookSignature`
  (HMAC-SHA256 with `META_APP_SECRET`; **fail-closed** if secret missing).
- Parses `entry[].changes[].value`:
  - `messages[]` → `processMessage` → find/create contact & conversation → insert message → dispatch automations + `message.received` webhook + AI auto-reply.
  - `statuses[]` → `handleStatusUpdate` → mirror on `messages` + `broadcast_recipients` + dispatch `message.status_updated` webhook.
  - `field === 'template_status'` → `handleTemplateWebhookChange`.
- All processing in `after()` callback so Meta gets 200 OK within 20s.

**Conversation/contact creation** (`src/app/api/whatsapp/webhook/route.ts:processMessage`):
- `findOrCreateContact` by normalized phone (suffix index + strict match).
- `findOrCreateConversation` per account+contact.
- Emits `conversation.created` webhook **before** message insert so subscriber sees thread open first.

---

## 5. Support Agent — Detect / Diagnose / Fix / Flag Boundaries

The agent (`src/lib/support-agent/index.ts`) runs periodically via
`GET /api/support-agent/cron` (protected by `SUPPORT_AGENT_CRON_SECRET`).

### 5.1 Detect — Known Failure Signatures

| Incident Type | Detection Logic | Table(s) Scanned |
|---------------|-----------------|------------------|
| `webhook_endpoint_disabled` | `is_active=false` AND `failure_count >= 15` (recent) | `webhook_endpoints` |
| `webhook_delivery_failing` | `is_active=true` AND `failure_count >= 10` | `webhook_endpoints` |
| `message_send_failed` | ≥3 messages with `status='failed'` in 24h | `messages` |
| `meta_api_error` | ≥2 automation logs with `status='failed'` and error contains "meta" + error code in 1h | `automation_logs` |
| `whatsapp_not_configured` | Account has no `whatsapp_config` row | `accounts` \ `whatsapp_config` |
| `meta_api_error` (decrypt) | `whatsapp_config.access_token` fails `decrypt()` | `whatsapp_config` |
| `cron_not_firing` | ≥1 `automation_pending_executions` with `status='pending'` AND `run_at <= now-5min` | `automation_pending_executions` |
| `automation_stuck` | `status='running'` for >10min | `automation_pending_executions` |
| `flow_run_stalled` | `flow_runs.status='active'` AND `last_advanced_at` older than fallback `on_timeout_hours` | `flow_runs` + `flows.fallback_policy` |

### 5.2 Diagnose — Checklist per Incident

Each diagnosis returns:
```ts
{
  rootCause: string,
  category: 'config' | 'external' | 'code' | 'infrastructure' | 'unknown',
  severity: 'low' | 'medium' | 'high' | 'critical',
  evidence: string[],
  recommendedAction: 'auto_fix' | 'human_review',
  fixDetails?: { type, targetId, params? }
}
```

**Key rules**:
- **Token expired (#190/#102)** → `config`, `critical`, **human_review** (secret rotation).
- **Rate limit (#131009)** → `external`, `medium`, **auto_fix** (retry with backoff).
- **Transient Meta error (#131000)** → `external`, `low`, **auto_fix** (retry).
- **Webhook unreachable (DNS/connrefused)** → `external`, `high`, **human_review**.
- **Cron not firing** → `infrastructure`, `high`, **human_review** (Vercel Cron / secret).
- **Stuck automation/flow** → `code`, `high`/`medium`, **auto_fix** (reset status).

### 5.3 Auto-Fix — Whitelisted Safe Actions Only

| Action | When Used | Operation |
|--------|-----------|-----------|
| `reenable_webhook` | `webhook_delivery_failing` / `webhook_endpoint_disabled` AND health check passes | `UPDATE webhook_endpoints SET is_active=true, failure_count=0 WHERE id=?` |
| `retry_send` | `message_send_failed` / `meta_api_error` (rate limit/transient) | Re-send via Meta API with exponential backoff; update message `status='sent'` |
| `restart_pending_execution` | `automation_stuck` (status='running' >10min) | `UPDATE automation_pending_executions SET status='pending' WHERE id=?` |
| `clear_stuck_execution` | `automation_stuck` (mark failed) / `flow_run_stalled` (mark timed_out) | Update status to `failed`/`done` or `completed`/`abandoned`; update log |

**Guardrails**:
- No schema changes, no code changes, no secret rotation.
- Every action logs to `incident_logs` with `action_taken`, `action_result`.
- Idempotent: re-running same fix is safe (status checks).

### 5.4 Flag for Human Review — Never Auto-Fix

- Anything touching **schema migrations**.
- **API key/secret rotation** (token expired, decrypt failed).
- **Code bugs** (rootCause category = 'code' without clear fix).
- **Repeated failures** the checklist can't explain (≥3 auto-fix attempts in 1h).
- **Critical severity** with `recommendedAction = human_review`.

Flagged incidents get `status='flagged_for_review'` in `incident_logs`.
Dashboard alert (future) or direct DB query surfaces them.

---

## 6. Incident Log Schema (Audit Trail)

`supabase/migrations/032_incident_logs.sql`:

```sql
CREATE TABLE incident_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid REFERENCES accounts(id) ON DELETE CASCADE,
  incident_type    text NOT NULL,              -- one of the 9 types above
  summary          text NOT NULL,              -- human-readable one-liner
  payload          jsonb NOT NULL DEFAULT '{}', -- structured context
  status           text NOT NULL CHECK (status IN (
    'detected', 'diagnosed', 'auto_fixed', 'flagged_for_review', 'manual_review_resolved'
  )),
  root_cause       text,                       -- filled after diagnose
  action_taken     text,                       -- e.g. 'reenable_webhook'
  fix_action       text,                       -- 'reenable_webhook:success'
  created_at       timestamptz DEFAULT now(),
  resolved_at      timestamptz
);
```

**Indexes**: `account_id`, `incident_type`, `status`, `created_at DESC`.

**RLS**: `SELECT` for any account member (`is_account_member(account_id)`).
**Write**: Only service-role (cron endpoint, internal helpers).

---

## 7. Conventions from AGENTS.md / CLAUDE.md (Reference Only)

- **Next.js 16** — App Router, `after()` for background work in webhooks.
- **Supabase service-role** for all server-side DB access (bypasses RLS).
- **Encryption** — AES-256-GCM via `ENCRYPTION_KEY` (32-byte hex). Legacy CBC rows auto-upgrade on decrypt.
- **Vitest** — `vitest run` for CI; env provides dummy `ENCRYPTION_KEY` + `META_APP_SECRET`.
- **Rate limiting** — In-memory, per-process (120 req/min per API key). Swap to Redis if multi-instance.
- **SSRF guard** — `isDeliverableUrl` resolves hostname, rejects private/link-local ranges.
- **Idempotency** — Webhook deliveries include `id` (uuid); receivers must dedupe.
- **Tenant isolation** — Every query filters by `account_id` (or `user_id` pre-migration 017). Service-role client used everywhere; RLS is defense-in-depth for UI.

---

## 8. Environment Variables Required

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-only) |
| `ENCRYPTION_KEY` | 32-byte hex for AES-256-GCM |
| `META_APP_SECRET` | Meta App Secret (for inbound webhook HMAC) |
| `META_APP_ID` | Meta App ID (for resumable media upload) |
| `AUTOMATION_CRON_SECRET` | Shared secret for `/api/automations/cron` + `/api/flows/cron` |
| `SUPPORT_AGENT_CRON_SECRET` | ← NEW: Secret for `/api/support-agent/cron` |
| `NEXT_PUBLIC_APP_URL` | Base URL for self-health checks (webhook re-enable) |

---

## 9. Running the Test Suite

```bash
cd wacrm
npm test              # vitest run
npm run test:watch    # vitest watch mode
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
```

New support agent tests: `src/lib/support-agent/support-agent.test.ts`

---

## 10. Quick Debugging Commands

```bash
# Check incident logs for an account
psql -c "SELECT * FROM incident_logs WHERE account_id='...' ORDER BY created_at DESC LIMIT 20;"

# See stuck automation executions
psql -c "SELECT * FROM automation_pending_executions WHERE status='running' AND created_at < now() - interval '10 minutes';"

# See disabled webhook endpoints
psql -c "SELECT * FROM webhook_endpoints WHERE is_active=false AND failure_count >= 15;"

# Manually trigger support agent check (requires secret)
curl -H "x-cron-secret: $SUPPORT_AGENT_CRON_SECRET" https://your-domain/api/support-agent/cron
```

---

## 11. Extending the Agent (For Future Sessions)

1. **Add new incident type**:
   - Add to `IncidentType` union in `types.ts`.
   - Add detector in `detect.ts` + register in `detectAllIssues`.
   - Add diagnosis branch in `diagnose.ts`.
   - If auto-fixable, add action in `fix.ts` + register in `executeFix`.
   - Update `032_incident_logs.sql` comment block with new type.

2. **Add new auto-fix action**:
   - Add to `FixAction.type` union.
   - Implement in `fix.ts` following pattern: verify → act → log.
   - **Must be idempotent and reversible** (or at least auditable).

3. **Change detection thresholds**:
   - Edit `THRESHOLDS` constant in `detect.ts` (or `DETECTION_THRESHOLDS` in `types.ts`).

4. **Add cron schedule**:
   - Vercel: `vercel.json` → `crons` array with `/api/support-agent/cron`.
   - Or external pinger (cron-job.org, GitHub Actions, etc.) hitting the endpoint with secret header.

---

*Generated for Marketing ko WA CRM v0.7.0+ — keep this file in sync with code changes.*