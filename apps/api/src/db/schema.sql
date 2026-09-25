CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(32) NOT NULL,
  username_normalized varchar(32) NOT NULL UNIQUE,
  display_name varchar(80) NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label varchar(80) NOT NULL,
  identity_public_key bytea,
  signed_prekey bytea,
  signed_prekey_signature bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (id, user_id)
);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS protocol_device_id smallint;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS registration_id integer;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS encrypted_device_name bytea;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_type varchar(16) NOT NULL DEFAULT 'web';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS devices_protocol_id_idx ON devices(user_id, protocol_device_id) WHERE protocol_device_id IS NOT NULL;
INSERT INTO devices(user_id, label)
SELECT u.id, 'Navegador principal' FROM users u
WHERE NOT EXISTS (SELECT 1 FROM devices d WHERE d.user_id=u.id);

CREATE TABLE IF NOT EXISTS one_time_prekeys (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key_id integer NOT NULL,
  public_key bytea NOT NULL,
  claimed_at timestamptz,
  UNIQUE(device_id, key_id)
);

CREATE TABLE IF NOT EXISTS account_public_identities (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identity_type varchar(3) NOT NULL CHECK (identity_type IN ('aci', 'pni')),
  version smallint NOT NULL CHECK (version = 1),
  x25519_public_key text NOT NULL,
  ed25519_public_key text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, identity_type)
);

CREATE TABLE IF NOT EXISTS protocol_prekeys (
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  identity_type varchar(3) NOT NULL CHECK (identity_type IN ('aci', 'pni')),
  key_type varchar(24) NOT NULL CHECK (key_type IN ('ecPreKey', 'ecSignedPreKey', 'kemOneTimePreKey', 'kemLastResortPreKey')),
  key_id integer NOT NULL,
  public_key text NOT NULL,
  signature text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  claimed_at timestamptz,
  PRIMARY KEY(device_id, identity_type, key_type, key_id)
);
CREATE INDEX IF NOT EXISTS protocol_prekeys_available_idx ON protocol_prekeys(device_id, identity_type, key_type, key_id) WHERE claimed_at IS NULL;

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direct_key varchar(73) UNIQUE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS direct_key varchar(73) UNIQUE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS encrypted_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_device_id uuid NOT NULL REFERENCES devices(id),
  recipient_device_id uuid NOT NULL REFERENCES devices(id),
  protocol_version smallint NOT NULL,
  envelope bytea NOT NULL CHECK (octet_length(envelope) BETWEEN 1 AND 1048576),
  client_message_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE(sender_device_id, recipient_device_id, client_message_id)
);
CREATE INDEX IF NOT EXISTS encrypted_messages_recipient_idx ON encrypted_messages(recipient_device_id, created_at);
CREATE INDEX IF NOT EXISTS encrypted_messages_conversation_idx ON encrypted_messages(conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS presence (
  device_id uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL,
  connection_id_hash char(64)
);

COMMENT ON COLUMN encrypted_messages.envelope IS 'Opaque E2EE protocol envelope. Plaintext is forbidden.';
COMMENT ON COLUMN devices.identity_public_key IS 'Public material only. Private keys must never be uploaded.';

CREATE TABLE IF NOT EXISTS e2ee_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_device_id smallint NOT NULL,
  sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_device_id smallint NOT NULL,
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 1 AND 1048576),
  message_type varchar(28) NOT NULL,
  delivery_class varchar(20) NOT NULL,
  client_timestamp bigint NOT NULL,
  client_message_id uuid NOT NULL,
  recipient_registration_id integer,
  content_hint integer,
  server_timestamp bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE(sender_user_id, client_message_id, target_device_id)
);
CREATE INDEX IF NOT EXISTS e2ee_envelopes_mailbox_idx ON e2ee_envelopes(target_user_id, target_device_id, created_at) WHERE delivered_at IS NULL;
COMMENT ON COLUMN e2ee_envelopes.ciphertext IS 'Opaque Signal Protocol envelope. Plaintext and private keys are forbidden.';
