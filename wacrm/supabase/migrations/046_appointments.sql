-- ============================================================
-- 046_appointments.sql — Booking & Appointments
--
-- Three entities:
--   booking_links        — public, shareable scheduling pages
--   appointment_availability — per-account weekly open windows
--   appointments         — bookings (dashboard + public create)
--
-- All account-scoped with RLS. Idempotent / safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- Public booking pages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Public, unguessable token used in the URL (/book/<token>).
  token        text NOT NULL UNIQUE,
  title        text NOT NULL DEFAULT 'Book a call',
  description  text,
  -- Optional pre-linked contact (e.g. a sales rep's personal link).
  contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_links_account_id_idx ON booking_links (account_id);
CREATE INDEX IF NOT EXISTS booking_links_token_idx     ON booking_links (token);

ALTER TABLE booking_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_links_select ON booking_links;
CREATE POLICY booking_links_select ON booking_links FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS booking_links_insert ON booking_links;
CREATE POLICY booking_links_insert ON booking_links FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS booking_links_update ON booking_links;
CREATE POLICY booking_links_update ON booking_links FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS booking_links_delete ON booking_links;
CREATE POLICY booking_links_delete ON booking_links FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- Weekly availability windows
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_availability (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- 0 = Sunday … 6 = Saturday (JS Date.getDay()).
  day_of_week   int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  -- Minutes from local midnight (e.g. 9:00 = 540).
  start_minutes int NOT NULL CHECK (start_minutes BETWEEN 0 AND 1439),
  end_minutes   int NOT NULL CHECK (end_minutes BETWEEN 0 AND 1439 AND end_minutes > start_minutes),
  -- Length of each bookable slot in minutes.
  slot_minutes  int NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 480),
  -- IANA timezone for interpreting the above (e.g. 'Asia/Kolkata').
  timezone      text NOT NULL DEFAULT 'UTC',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS appointment_availability_account_id_idx
  ON appointment_availability (account_id);

ALTER TABLE appointment_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_availability_select ON appointment_availability;
CREATE POLICY appointment_availability_select ON appointment_availability FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS appointment_availability_insert ON appointment_availability;
CREATE POLICY appointment_availability_insert ON appointment_availability FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS appointment_availability_update ON appointment_availability;
CREATE POLICY appointment_availability_update ON appointment_availability FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS appointment_availability_delete ON appointment_availability;
CREATE POLICY appointment_availability_delete ON appointment_availability FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- Appointments (bookings)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  booking_link_id   uuid REFERENCES booking_links(id) ON DELETE SET NULL,
  -- Public token for the contact to reschedule / cancel.
  booking_token     text NOT NULL UNIQUE,
  contact_id        uuid REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id           uuid REFERENCES deals(id) ON DELETE SET NULL,
  -- Human name + phone captured from the public form (so a booking
  -- still works for a not-yet-existing contact).
  customer_name     text,
  customer_phone    text,
  scheduled_at      timestamptz NOT NULL,
  duration_minutes  int NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  status            text NOT NULL DEFAULT 'confirmed'
                      CHECK (status IN ('confirmed', 'completed', 'cancelled', 'no_show')),
  notes             text,
  -- When the reminder WhatsApp was sent (cron clears + sends once).
  reminder_sent_at  timestamptz,
  -- Meta message id of the confirmation, for tracing.
  whatsapp_msg_id   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointments_account_id_idx     ON appointments (account_id);
CREATE INDEX IF NOT EXISTS appointments_contact_id_idx    ON appointments (contact_id);
CREATE INDEX IF NOT EXISTS appointments_scheduled_at_idx  ON appointments (scheduled_at);
CREATE INDEX IF NOT EXISTS appointments_reminder_idx
  ON appointments (scheduled_at, status) WHERE reminder_sent_at IS NULL;

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointments_select ON appointments;
CREATE POLICY appointments_select ON appointments FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS appointments_insert ON appointments;
CREATE POLICY appointments_insert ON appointments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS appointments_update ON appointments;
CREATE POLICY appointments_update ON appointments FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS appointments_delete ON appointments;
CREATE POLICY appointments_delete ON appointments FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Keep updated_at fresh.
DROP TRIGGER IF EXISTS booking_links_set_updated_at ON booking_links;
CREATE TRIGGER booking_links_set_updated_at
  BEFORE UPDATE ON booking_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS appointment_availability_set_updated_at ON appointment_availability;
CREATE TRIGGER appointment_availability_set_updated_at
  BEFORE UPDATE ON appointment_availability
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS appointments_set_updated_at ON appointments;
CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
