import { describe, expect, it } from 'vitest';
import type { Conversation, EncryptedMessage, IdentityType, NewEnvelope, PreKeyUpload, ProtocolDevice, PublicIdentity, RelayEnvelope, Repository, PublicUser, StoredUser } from './repository.js';
import { buildApp } from './app.js';

class MemoryRepository implements Repository {
  users: StoredUser[] = []; sessions = new Map<string, string>(); conversations: Array<Conversation & { memberIds: string[] }> = []; messages: EncryptedMessage[] = [];
  devices = new Map<string, ProtocolDevice[]>(); identities = new Map<string, PublicIdentity>(); prekeys = new Map<string, PreKeyUpload[]>(); relayEnvelopes: RelayEnvelope[] = [];
  async createUser(i: { username: string; normalized: string; displayName: string; passwordHash: string }) { const user = { id: crypto.randomUUID(), username: i.username, displayName: i.displayName, passwordHash: i.passwordHash, createdAt: new Date().toISOString() }; this.users.push(user); return this.public(user); }
  async findUserByNormalized(n: string) { return this.users.find(u => u.username.toLowerCase() === n) ?? null; }
  async createSession(userId: string, tokenHash: string) { this.sessions.set(tokenHash, userId); }
  async findUserBySession(tokenHash: string) { const id = this.sessions.get(tokenHash); const user = this.users.find(u => u.id === id); return user ? this.public(user) : null; }
  async revokeSession(tokenHash: string) { this.sessions.delete(tokenHash); }
  async searchUsers(query: string, excludeUserId: string, limit: number) { return this.users.filter(user => user.id !== excludeUserId && (user.username.toLowerCase().startsWith(query) || user.displayName.toLowerCase().startsWith(query))).slice(0, limit).map(user => this.public(user)); }
  async createDirectConversation(userId: string, peerId: string) { const peer = this.users.find(user => user.id === peerId); if (!peer || userId === peerId) return null; const existing = this.conversations.find(conversation => conversation.memberIds.includes(userId) && conversation.memberIds.includes(peerId)); if (existing) return existing; const conversation = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), peer: this.public(peer), memberIds: [userId, peerId] }; this.conversations.push(conversation); return conversation; }
  async listConversations(userId: string) { return this.conversations.filter(conversation => conversation.memberIds.includes(userId)); }
  async isConversationMember(conversationId: string, userId: string) { return this.conversations.some(conversation => conversation.id === conversationId && conversation.memberIds.includes(userId)); }
  async listConversationMemberIds(conversationId: string) { return this.conversations.find(conversation => conversation.id === conversationId)?.memberIds ?? []; }
  async listEncryptedMessages(conversationId: string) { return this.messages.filter(message => message.conversationId === conversationId); }
  async createEncryptedMessage(userId: string, input: NewEnvelope) { if (!(await this.isConversationMember(input.conversationId, userId))) return null; const message = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }; this.messages.push(message); return message; }
  async registerProtocolDevice(userId: string, requested = 1, encryptedDeviceName?: string) { const current = this.devices.get(userId) ?? []; if (!current.some(item => item.deviceId === requested)) current.push({ deviceId: requested, encryptedDeviceName, deviceType: 'web', registered: false, linked: requested !== 1, enabled: true, createdAt: Date.now() }); this.devices.set(userId, current); return requested; }
  async listProtocolDevices(userId: string) { return this.devices.get(userId) ?? []; }
  async provisionPublicIdentity(userId: string, deviceId: number, _registrationId: number, identityType: IdentityType, identity: PublicIdentity) { const key = `${userId}:${identityType}`; const current = this.identities.get(key); if (current && JSON.stringify(current) !== JSON.stringify(identity)) return 'conflict' as const; this.identities.set(key, identity); const device = (this.devices.get(userId) ?? []).find(item => item.deviceId === deviceId); if (device) device.registered = true; return current ? 'matched' as const : 'created' as const; }
  async getPublicIdentity(userId: string, identityType: IdentityType) { return this.identities.get(`${userId}:${identityType}`) ?? null; }
  async uploadPreKeys(userId: string, deviceId: number, identityType: IdentityType, keys: PreKeyUpload[]) { if (!(this.devices.get(userId) ?? []).some(item => item.deviceId === deviceId)) return false; this.prekeys.set(`${userId}:${deviceId}:${identityType}`, keys); return true; }
  async getPreKeyInventory(userId: string, deviceId: number, identityType: IdentityType) { const keys = this.prekeys.get(`${userId}:${deviceId}:${identityType}`) ?? []; const meta = (type: string) => { const key = keys.find(item => item.type === type); return key ? { keyId: key.keyId, publicKey: key.publicKey, createdAt: Date.now(), expiresAt: Date.now() + 1000 } : null; }; return { ecSignedPreKey: meta('ecSignedPreKey'), kemLastResortPreKey: meta('kemLastResortPreKey'), ecOneTimePreKeyCount: keys.filter(item => item.type === 'ecPreKey').length, kemOneTimePreKeyCount: keys.filter(item => item.type === 'kemOneTimePreKey').length }; }
  async fetchPreKeyBundle() { return null; }
  async createRelayEnvelope(userId: string, envelope: RelayEnvelope) { const allowed = this.conversations.some(item => item.memberIds.includes(userId) && item.memberIds.includes(envelope.targetUserId)); if (!allowed || envelope.senderUserId !== userId) return null; const stored = { ...envelope, id: crypto.randomUUID(), serverTimestamp: Date.now() }; this.relayEnvelopes.push(stored); return stored; }
  async listPendingEnvelopes(userId: string, deviceId: number) { return this.relayEnvelopes.filter(item => item.targetUserId === userId && item.targetDeviceId === deviceId); }
  async markEnvelopeDelivered(userId: string, envelopeId: string) { return this.relayEnvelopes.some(item => item.id === envelopeId && item.targetUserId === userId); }
  private public({ passwordHash: _, ...user }: StoredUser): PublicUser { return user; }
}
const config = { NODE_ENV: 'test' as const, API_PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'unused', SESSION_PEPPER: 'x'.repeat(32) };

describe('authentication boundary', () => {
  it('registers, issues an HttpOnly cookie and resolves the session', async () => {
    const app = buildApp(config, new MemoryRepository());
    const register = await app.inject({ method: 'POST', url: '/auth/register', payload: { username: 'Alice', displayName: 'Alice', password: 'correct horse battery staple' } });
    expect(register.statusCode).toBe(201); expect(register.json()).not.toHaveProperty('user.passwordHash');
    const rawCookie = register.headers['set-cookie']; const cookie = Array.isArray(rawCookie) ? rawCookie[0]! : rawCookie!; expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict');
    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: cookie.split(';')[0]! } });
    expect(me.statusCode).toBe(200); expect(me.json().user.username).toBe('Alice'); await app.close();
  });
  it('does not reveal whether a valid-shaped login failed by user or password', async () => {
    const app = buildApp(config, new MemoryRepository());
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'missing', password: 'incorrect password value' } });
    expect(response.statusCode).toBe(401); expect(response.json()).toEqual({ error: 'invalid_credentials' }); await app.close();
  });
  it('rejects unknown fields so private payloads cannot accidentally enter auth', async () => {
    const app = buildApp(config, new MemoryRepository());
    const response = await app.inject({ method: 'POST', url: '/auth/register', payload: { username: 'Alice', displayName: 'Alice', password: 'correct horse battery staple', privateKey: 'never-upload' } });
    expect(response.statusCode).toBe(400); await app.close();
  });
});

describe('phase 3 E2EE boundary', () => {
  async function register(app: ReturnType<typeof buildApp>, username: string) { const response = await app.inject({ method: 'POST', url: '/auth/register', payload: { username, displayName: username, password: 'correct horse battery staple' } }); const raw = response.headers['set-cookie']; return { cookie: (Array.isArray(raw) ? raw[0]! : raw!).split(';')[0]!, user: response.json().user as PublicUser }; }
  it('accepts public keys but rejects private key material at the API boundary', async () => { const app = buildApp(config, new MemoryRepository()); const alice = await register(app, 'Alice'); await app.inject({ method: 'POST', url: '/e2ee/devices', headers: { cookie: alice.cookie }, payload: { deviceId: 1, deviceType: 'web' } }); const response = await app.inject({ method: 'POST', url: '/e2ee/identity', headers: { cookie: alice.cookie }, payload: { userId: alice.user.id, deviceId: 1, registrationId: 42, identity: { version: 1, x25519PublicKey: 'A'.repeat(44), ed25519PublicKey: 'B'.repeat(44), privateKey: 'must-never-upload' } } }); expect(response.statusCode).toBe(400); await app.close(); });
  it('stores and returns only opaque ciphertext to an authorized participant', async () => { const repository = new MemoryRepository(); const app = buildApp(config, repository); const alice = await register(app, 'Alice'); const bob = await register(app, 'Bob'); await app.inject({ method: 'POST', url: '/conversations', headers: { cookie: alice.cookie }, payload: { peerUserId: bob.user.id } }); const secret = 'mensagem ultrassecreta'; const ciphertext = Buffer.from(crypto.getRandomValues(new Uint8Array(96))).toString('base64'); const payload = { targetUserId: bob.user.id, targetDeviceId: 1, senderUserId: alice.user.id, senderDeviceId: 1, ciphertext, messageType: 'ciphertext', deliveryClass: 'user-visible', timestamp: Date.now(), clientMessageId: crypto.randomUUID() }; const sent = await app.inject({ method: 'POST', url: '/e2ee/envelopes', headers: { cookie: alice.cookie }, payload }); expect(sent.statusCode).toBe(201); expect(JSON.stringify(repository.relayEnvelopes)).not.toContain(secret); expect(repository.relayEnvelopes[0]?.ciphertext).toBe(ciphertext); const mailbox = await app.inject({ method: 'GET', url: '/e2ee/mailbox?deviceId=1', headers: { cookie: bob.cookie } }); expect(mailbox.statusCode).toBe(200); expect(mailbox.json().envelopes[0].ciphertext).toBe(ciphertext); expect(mailbox.body).not.toContain(secret); await app.close(); });
  it('prevents a non-participant from injecting an envelope', async () => { const repository = new MemoryRepository(); const app = buildApp(config, repository); const alice = await register(app, 'Alice'); const bob = await register(app, 'Bob'); const mallory = await register(app, 'Mallory'); await app.inject({ method: 'POST', url: '/conversations', headers: { cookie: alice.cookie }, payload: { peerUserId: bob.user.id } }); const response = await app.inject({ method: 'POST', url: '/e2ee/envelopes', headers: { cookie: mallory.cookie }, payload: { targetUserId: bob.user.id, targetDeviceId: 1, senderUserId: mallory.user.id, senderDeviceId: 1, ciphertext: Buffer.from('opaque').toString('base64'), messageType: 'ciphertext', deliveryClass: 'user-visible', timestamp: Date.now(), clientMessageId: crypto.randomUUID() } }); expect(response.statusCode).toBe(404); await app.close(); });
});

describe('phase 2 transport boundary', () => {
  async function register(app: ReturnType<typeof buildApp>, username: string) {
    const response = await app.inject({ method: 'POST', url: '/auth/register', payload: { username, displayName: username, password: 'correct horse battery staple' } });
    const raw = response.headers['set-cookie']; const cookie = (Array.isArray(raw) ? raw[0]! : raw!).split(';')[0]!;
    return { cookie, user: response.json().user as PublicUser };
  }
  it('discovers users and creates an idempotent direct conversation', async () => {
    const repository = new MemoryRepository(); const app = buildApp(config, repository); const alice = await register(app, 'Alice'); const bob = await register(app, 'Bob');
    const search = await app.inject({ method: 'GET', url: '/users/search?q=bo', headers: { cookie: alice.cookie } }); expect(search.statusCode).toBe(200); expect(search.json().users.map((user: PublicUser) => user.username)).toEqual(['Bob']);
    const first = await app.inject({ method: 'POST', url: '/conversations', headers: { cookie: alice.cookie }, payload: { peerUserId: bob.user.id } }); const second = await app.inject({ method: 'POST', url: '/conversations', headers: { cookie: alice.cookie }, payload: { peerUserId: bob.user.id } });
    expect(first.statusCode).toBe(201); expect(second.json().conversation.id).toBe(first.json().conversation.id); await app.close();
  });
  it('hides conversations from non-members', async () => {
    const repository = new MemoryRepository(); const app = buildApp(config, repository); const alice = await register(app, 'Alice'); const bob = await register(app, 'Bob'); const mallory = await register(app, 'Mallory');
    const created = await app.inject({ method: 'POST', url: '/conversations', headers: { cookie: alice.cookie }, payload: { peerUserId: bob.user.id } });
    const response = await app.inject({ method: 'GET', url: `/conversations/${created.json().conversation.id}/messages`, headers: { cookie: mallory.cookie } }); expect(response.statusCode).toBe(404); expect(response.json()).toEqual({ error: 'conversation_not_found' }); await app.close();
  });
  it('rejects plaintext-shaped messages and accepts only an opaque canonical envelope', async () => {
    const repository = new MemoryRepository(); const app = buildApp(config, repository); const alice = await register(app, 'Alice'); const bob = await register(app, 'Bob'); const created = await app.inject({ method: 'POST', url: '/conversations', headers: { cookie: alice.cookie }, payload: { peerUserId: bob.user.id } }); const id = created.json().conversation.id;
    const identifiers = { senderDeviceId: crypto.randomUUID(), recipientDeviceId: crypto.randomUUID(), protocolVersion: 1, clientMessageId: crypto.randomUUID() };
    const plaintext = await app.inject({ method: 'POST', url: `/conversations/${id}/messages`, headers: { cookie: alice.cookie }, payload: { ...identifiers, envelope: Buffer.from('ciphertext').toString('base64'), text: 'segredo' } }); expect(plaintext.statusCode).toBe(400);
    const accepted = await app.inject({ method: 'POST', url: `/conversations/${id}/messages`, headers: { cookie: alice.cookie }, payload: { ...identifiers, envelope: Buffer.from('opaque bytes').toString('base64') } }); expect(accepted.statusCode).toBe(201); expect(accepted.json().message).not.toHaveProperty('text'); await app.close();
  });
  it('authenticates the WebSocket and answers a transport ping', async () => {
    const app = buildApp(config, new MemoryRepository()); const alice = await register(app, 'Alice'); await app.ready();
    const socket = await app.injectWS('/realtime', { headers: { cookie: alice.cookie, origin: config.WEB_ORIGIN } });
    const pong = new Promise<string>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('websocket timeout')), 1_000); socket.on('message', data => { const value = data.toString(); if (value === '{"type":"pong"}') { clearTimeout(timeout); resolve(value); } }); });
    socket.send('{"type":"ping"}'); expect(await pong).toBe('{"type":"pong"}'); socket.close(); await app.close();
  });
});
