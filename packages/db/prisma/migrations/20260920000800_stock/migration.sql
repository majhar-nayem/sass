-- C-06 -- the shared stock pool.
--
-- Its own table rather than site_assets with a nullable site_id: stock is shared by
-- every tenant, has no owner, is not subject to org RLS, and is not deleted when a
-- customer leaves. Overloading site_assets would mean a nullable tenant key on a table
-- whose entire purpose is tenant scoping.
CREATE TABLE IF NOT EXISTS stock_assets (
  id           text PRIMARY KEY,
  description  text NOT NULL,
  industries   text[] NOT NULL DEFAULT '{}',
  tags         text[] NOT NULL DEFAULT '{}',
  kind         text NOT NULL DEFAULT 'photo',
  licence      text NOT NULL,
  credit       text,
  source_url   text,
  storage_key  text NOT NULL,
  public_url   text NOT NULL,
  width        integer NOT NULL,
  height       integer NOT NULL,
  bytes        integer NOT NULL,
  blur_data_url text,
  ingested_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_assets_industries_idx ON stock_assets USING GIN (industries);

-- Readable by every tenant, writable only by the ingest job running as the owner.
GRANT SELECT ON stock_assets TO awning_app;
