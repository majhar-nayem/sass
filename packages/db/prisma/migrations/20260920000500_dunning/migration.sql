-- O-03 -- which dunning reminders have gone out.
--
-- On the subscription rather than a separate table: it is a tiny array with exactly one
-- writer, and a join to answer "have we already emailed them about day 3" would be a
-- table that exists solely to hold three integers.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS dunning_emails_sent jsonb NOT NULL DEFAULT '[]'::jsonb;

-- The sweep reads past_due subscriptions daily and pending domains every few minutes.
CREATE INDEX IF NOT EXISTS subscriptions_past_due_idx
  ON subscriptions (updated_at) WHERE status = 'past_due';
