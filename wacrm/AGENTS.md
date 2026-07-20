<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Feature map (built modules)

- **Tasks + Reminders** — `supabase/migrations/044_tasks.sql`, `045_task_reminder_notifications.sql`; `/api/tasks`, `/api/tasks/[id]`, `/api/tasks/reminders/cron` (Vercel cron `*/15`).
- **Appointments / Booking** — `046_appointments.sql`; dashboard API (`availability`, `booking-links`, `appointments`) + public `/api/book/[token]` & `/api/book/appointment/[bookingToken]`; `/api/appointments/reminders/cron` (`*/30`); `src/lib/appointments/slots.ts`; UI `/appointments` + public `/book/[token]`.
- **Intake Forms + Customer Portal** — `047_forms_portal.sql`; `/api/forms`, `/api/forms/[id]`, `/api/forms/public/[token]`, `/api/portal-links`, `/api/portal/[token]`; UI `/forms`, `/forms/[token]`, `/portal/[token]`. Submissions auto-create contacts + fire automations + `dispatchIntegrations`.
- **Integrations** — `048_integrations.sql`; `src/lib/integrations/notify.ts` (Slack webhook + Resend email via pure `fetch`, AES-GCM secrets); `/api/integrations/config`; settings tab.
- **SSO (self-serve OIDC)** — `049_sso_providers.sql`; `src/lib/sso/oidc.ts` (pure-`fetch` OIDC: discovery/PKCE/exchange/userinfo); `/api/sso/[id]/login` + `/api/sso/[id]/callback` (bridges IdP identity → service-role `auth.admin.createUser` → magic-link session so middleware/R(ActionEvent)LS keep working); `/api/sso/providers` (+ `[id]`, `public`); settings tab + login buttons. SAML reserved in schema but not yet wired.

# Conventions that bit us
- Dynamic route handlers declare `params: Promise<{ id: string }>` and `await params` — this Next.js version passes a Promise.
- `generateLink({ type: 'magiclink' })` here takes NO `redirectTo` arg.
- API routes gate with `requireRole('admin'|'viewer')` from `@/lib/auth/account` (returns `{ supabase, accountId, userId, role }`), NOT a `requireRole(supabase, role)` signature.
- Login/callback SSO routes use the service-role client (`@/lib/automations/admin-client`) and bypass RLS; never reuse a cookie-authed client there.
- Builds/tests use Node 24 (`node_modules/.bin`/v24 path), not the system Node.
