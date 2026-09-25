import pg from 'pg';

export type PublicUser = { id: string; username: string; displayName: string; createdAt: string };
export type StoredUser = PublicUser & { passwordHash: string };
export type Conversation = { id: string; createdAt: string; peer: PublicUser };
export type EncryptedMessage = { id: string; conversationId: string; senderDeviceId: string; recipientDeviceId: string; protocolVersion: number; envelope: string; clientMessageId: string; createdAt: string };
export type NewEnvelope = Omit<EncryptedMessage, 'id' | 'createdAt'>;

export interface Repository {
  createUser(input: { username: string; normalized: string; displayName: string; passwordHash: string }): Promise<PublicUser>;
  findUserByNormalized(normalized: string): Promise<StoredUser | null>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findUserBySession(tokenHash: string): Promise<PublicUser | null>;
  revokeSession(tokenHash: string): Promise<void>;
  searchUsers(query: string, excludeUserId: string, limit: number): Promise<PublicUser[]>;
  createDirectConversation(userId: string, peerId: string): Promise<Conversation | null>;
  listConversations(userId: string): Promise<Conversation[]>;
  isConversationMember(conversationId: string, userId: string): Promise<boolean>;
  listConversationMemberIds(conversationId: string): Promise<string[]>;
  listEncryptedMessages(conversationId: string, before: string | null, limit: number): Promise<EncryptedMessage[]>;
  createEncryptedMessage(userId: string, input: NewEnvelope): Promise<EncryptedMessage | null>;
}

const publicUserColumns = `u.id, u.username, u.display_name AS "displayName", u.created_at AS "createdAt"`;
const messageColumns = `m.id, m.conversation_id AS "conversationId", m.sender_device_id AS "senderDeviceId", m.recipient_device_id AS "recipientDeviceId", m.protocol_version AS "protocolVersion", encode(m.envelope, 'base64') AS envelope, m.client_message_id AS "clientMessageId", m.created_at AS "createdAt"`;

export class PostgresRepository implements Repository {
  constructor(private readonly pool: pg.Pool) {}
  async createUser(input: { username: string; normalized: string; displayName: string; passwordHash: string }) {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await client.query(`INSERT INTO users(username, username_normalized, display_name, password_hash) VALUES($1,$2,$3,$4) RETURNING id, username, display_name AS "displayName", created_at AS "createdAt"`, [input.username, input.normalized, input.displayName, input.passwordHash]); await client.query(`INSERT INTO devices(user_id, label) VALUES($1, 'Navegador principal')`, [result.rows[0].id]); await client.query('COMMIT'); return result.rows[0] as PublicUser; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async findUserByNormalized(normalized: string) { const result = await this.pool.query(`SELECT ${publicUserColumns}, u.password_hash AS "passwordHash" FROM users u WHERE u.username_normalized=$1`, [normalized]); return (result.rows[0] as StoredUser | undefined) ?? null; }
  async createSession(userId: string, tokenHash: string, expiresAt: Date) { await this.pool.query('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES($1,$2,$3)', [userId, tokenHash, expiresAt]); }
  async findUserBySession(tokenHash: string) { const result = await this.pool.query(`SELECT ${publicUserColumns} FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [tokenHash]); return (result.rows[0] as PublicUser | undefined) ?? null; }
  async revokeSession(tokenHash: string) { await this.pool.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHash]); }
  async searchUsers(query: string, excludeUserId: string, limit: number) { const result = await this.pool.query(`SELECT ${publicUserColumns} FROM users u WHERE u.id<>$1 AND (u.username_normalized LIKE $2 OR lower(u.display_name) LIKE $2) ORDER BY CASE WHEN u.username_normalized=$3 THEN 0 ELSE 1 END, u.username_normalized LIMIT $4`, [excludeUserId, `${query}%`, query, limit]); return result.rows as PublicUser[]; }
  async createDirectConversation(userId: string, peerId: string) {
    if (userId === peerId) return null; const key = [userId, peerId].sort().join(':'); const client = await this.pool.connect();
    try { await client.query('BEGIN'); const peer = await client.query(`SELECT ${publicUserColumns} FROM users u WHERE u.id=$1`, [peerId]); if (!peer.rows[0]) { await client.query('ROLLBACK'); return null; } const conversation = await client.query(`INSERT INTO conversations(direct_key, created_by) VALUES($1,$2) ON CONFLICT(direct_key) DO UPDATE SET direct_key=EXCLUDED.direct_key RETURNING id, created_at AS "createdAt"`, [key, userId]); await client.query(`INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2),($1,$3) ON CONFLICT DO NOTHING`, [conversation.rows[0].id, userId, peerId]); await client.query('COMMIT'); return { ...conversation.rows[0], peer: peer.rows[0] } as Conversation; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async listConversations(userId: string) { const result = await this.pool.query(`SELECT c.id, c.created_at AS "createdAt", p.id AS "peerId", p.username AS "peerUsername", p.display_name AS "peerDisplayName", p.created_at AS "peerCreatedAt" FROM conversations c JOIN conversation_members mine ON mine.conversation_id=c.id AND mine.user_id=$1 JOIN conversation_members other ON other.conversation_id=c.id AND other.user_id<>$1 JOIN users p ON p.id=other.user_id ORDER BY c.created_at DESC`, [userId]); return result.rows.map(row => ({ id: row.id, createdAt: row.createdAt, peer: { id: row.peerId, username: row.peerUsername, displayName: row.peerDisplayName, createdAt: row.peerCreatedAt } })) as Conversation[]; }
  async isConversationMember(conversationId: string, userId: string) { const result = await this.pool.query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2', [conversationId, userId]); return result.rowCount === 1; }
  async listConversationMemberIds(conversationId: string) { const result = await this.pool.query('SELECT user_id FROM conversation_members WHERE conversation_id=$1', [conversationId]); return result.rows.map(row => row.user_id as string); }
  async listEncryptedMessages(conversationId: string, before: string | null, limit: number) { const result = await this.pool.query(`SELECT ${messageColumns} FROM encrypted_messages m WHERE m.conversation_id=$1 AND ($2::timestamptz IS NULL OR m.created_at<$2) ORDER BY m.created_at DESC, m.id DESC LIMIT $3`, [conversationId, before, limit]); return (result.rows as EncryptedMessage[]).reverse(); }
  async createEncryptedMessage(userId: string, input: NewEnvelope) { const result = await this.pool.query(`INSERT INTO encrypted_messages(conversation_id,sender_device_id,recipient_device_id,protocol_version,envelope,client_message_id) SELECT $1,$2,$3,$4,decode($5,'base64'),$6 WHERE EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$7) AND EXISTS (SELECT 1 FROM devices WHERE id=$2 AND user_id=$7 AND revoked_at IS NULL) AND EXISTS (SELECT 1 FROM devices d JOIN conversation_members cm ON cm.user_id=d.user_id AND cm.conversation_id=$1 WHERE d.id=$3 AND d.revoked_at IS NULL) ON CONFLICT(sender_device_id,recipient_device_id,client_message_id) DO UPDATE SET client_message_id=EXCLUDED.client_message_id RETURNING id, conversation_id AS "conversationId", sender_device_id AS "senderDeviceId", recipient_device_id AS "recipientDeviceId", protocol_version AS "protocolVersion", encode(envelope,'base64') AS envelope, client_message_id AS "clientMessageId", created_at AS "createdAt"`, [input.conversationId, input.senderDeviceId, input.recipientDeviceId, input.protocolVersion, input.envelope, input.clientMessageId, userId]); return (result.rows[0] as EncryptedMessage | undefined) ?? null; }
}
