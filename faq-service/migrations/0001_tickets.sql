-- FAQ support tickets (F28.3). The ticket's `status` is a cache of the latest history row for
-- cheap filtering; ticket_status_history is the source of truth and is insert-only: the app
-- never UPDATEs or DELETEs history.
-- No requester identity is stored: the reply-to address is the only contact. Admin actions ARE
-- attributed (admin_id), because that is the accountability trail.

CREATE TABLE IF NOT EXISTS tickets (
  ticket_id       text PRIMARY KEY,
  question        text NOT NULL,
  matched_topics  jsonb NOT NULL DEFAULT '[]',
  reply_to        text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  resolved_by     text,
  resolved_at     timestamptz
);

CREATE TABLE IF NOT EXISTS ticket_status_history (
  id          bigserial PRIMARY KEY,
  ticket_id   text NOT NULL REFERENCES tickets (ticket_id),
  from_status text,
  to_status   text NOT NULL,
  admin_id    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tickets_created_at_idx ON tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS ticket_status_history_ticket_idx ON ticket_status_history (ticket_id, id);
