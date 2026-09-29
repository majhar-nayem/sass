-- M-07 -- did anyone hear about this order?
--
-- Same shape as form_submissions.notified_at, and for the same reason. Mail is sent
-- after the order commits, so a failed send cannot lose the order — but it can lose the
-- butcher's knowledge of it, which on 23 December is the same thing. Set only when the
-- send succeeds, so the daily digest can say "paid, and nobody was told".

ALTER TABLE orders ADD COLUMN owner_notified_at    timestamptz;
ALTER TABLE orders ADD COLUMN customer_notified_at timestamptz;

CREATE INDEX orders_owner_unnotified_idx ON orders (created_at)
  WHERE owner_notified_at IS NULL AND status = 'paid';
