import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import type { Config } from './config.js';
import type { EncryptedMessage, PublicUser, Repository } from './repository.js';
import { hashPassword, hashSessionToken, newSessionToken, normalizeUsername, verifyPassword } from './security.js';

const credentials = z.object({ username: z.string().trim().min(3).max(32).regex(/^[\p{L}\p{N}_.-]+$/u), password: z.string().min(12).max(256) }).strict();
const registration = credentials.extend({ displayName: z.string().trim().min(1).max(80) }).strict();
const conversationInput = z.object({ peerUserId: z.string().uuid() }).strict();
const envelopeInput = z.object({
  senderDeviceId: z.string().uuid(), recipientDeviceId: z.string().uuid(), protocolVersion: z.number().int().min(1).max(32),
  clientMessageId: z.string().uuid(), envelope: z.string().min(4).max(1_398_104).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict().superRefine((value, context) => { try { const bytes = Buffer.from(value.envelope, 'base64'); if (bytes.length < 1 || bytes.length > 1_048_576 || bytes.toString('base64') !== value.envelope) context.addIssue({ code: 'custom', message: 'invalid envelope' }); } catch { context.addIssue({ code: 'custom', message: 'invalid envelope' }); } });
const uuidParams = z.object({ id: z.string().uuid() });
const identityType = z.enum(['aci', 'pni']).default('aci');
const deviceId = z.number().int().min(1).max(5);
const publicIdentity = z.object({ version: z.literal(1), x25519PublicKey: z.string().min(20).max(256), ed25519PublicKey: z.string().min(20).max(256) }).strict();
const preKey = z.object({ type: z.enum(['ecPreKey', 'ecSignedPreKey', 'kemOneTimePreKey', 'kemLastResortPreKey']), keyId: z.number().int().nonnegative(), publicKey: z.string().min(20).max(4096), signature: z.string().min(20).max(512).optional() }).strict();
const relayEnvelope = z.object({ targetUserId: z.string().uuid(), targetDeviceId: deviceId, senderUserId: z.string().uuid(), senderDeviceId: deviceId, ciphertext: z.string().min(4).max(1_398_104).regex(/^[A-Za-z0-9+/]+={0,2}$/), messageType: z.enum(['ciphertext', 'prekey_bundle', 'sender_key', 'server_delivery_receipt', 'unidentified_sender']), deliveryClass: z.enum(['user-visible', 'background-sync', 'ephemeral']), timestamp: z.number().int().nonnegative(), clientMessageId: z.string().uuid(), recipientRegistrationId: z.number().int().nonnegative().optional(), contentHint: z.number().int().optional() }).strict();
const COOKIE = '__Host-privy_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

type AuthedRequest = FastifyRequest & { currentUser: PublicUser };

export function buildApp(config: Config, repository: Repository) {
  const app = Fastify({ logger: { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password', 'req.body.envelope', 'req.body.ciphertext', 'res.headers.set-cookie'] }, bodyLimit: 1_450_000, trustProxy: false });
  const connections = new Map<string, Set<{ readyState: number; send(data: string): void; close(code?: number, reason?: string): void }>>();
  app.register(cookie); app.register(websocket);
  app.register(cors, { origin: config.WEB_ORIGIN, credentials: true, methods: ['GET', 'POST'] });
  app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } } });
  app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  const cookieOptions = { path: '/', httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict' as const, maxAge: SESSION_MS / 1000 };
  const sessionHash = (request: { cookies: Record<string, string | undefined> }) => { const token = request.cookies[COOKIE]; return token ? hashSessionToken(token, config.SESSION_PEPPER) : null; };
  const resolveUser = async (request: { cookies: Record<string, string | undefined> }) => { const hash = sessionHash(request); return hash ? repository.findUserBySession(hash) : null; };
  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => { const user = await resolveUser(request); if (!user) return reply.code(401).send({ error: 'unauthorized' }); (request as AuthedRequest).currentUser = user; };
  const setSession = async (reply: FastifyReply, userId: string) => { const token = newSessionToken(); await repository.createSession(userId, hashSessionToken(token, config.SESSION_PEPPER), new Date(Date.now() + SESSION_MS)); reply.setCookie(COOKIE, token, cookieOptions); };
  const broadcast = async (conversationId: string, event: { type: string; message: EncryptedMessage }) => { const payload = JSON.stringify(event); const userIds = await repository.listConversationMemberIds(conversationId); for (const id of userIds) for (const socket of connections.get(id) ?? []) if (socket.readyState === 1) socket.send(payload); };
  const sendToUser = (userId: string, event: unknown) => { const payload = JSON.stringify(event); for (const socket of connections.get(userId) ?? []) if (socket.readyState === 1) socket.send(payload); };

  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = registration.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' }); const normalized = normalizeUsername(parsed.data.username);
    if (await repository.findUserByNormalized(normalized)) return reply.code(409).send({ error: 'username_unavailable' });
    try { const user = await repository.createUser({ username: parsed.data.username, normalized, displayName: parsed.data.displayName, passwordHash: await hashPassword(parsed.data.password) }); await setSession(reply, user.id); return reply.code(201).send({ user }); }
    catch (error: unknown) { if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'username_unavailable' }); throw error; }
  });
  app.post('/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => { const parsed = credentials.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' }); const user = await repository.findUserByNormalized(normalizeUsername(parsed.data.username)); if (!user || !(await verifyPassword(user.passwordHash, parsed.data.password))) return reply.code(401).send({ error: 'invalid_credentials' }); await setSession(reply, user.id); const { passwordHash: _, ...safeUser } = user; return { user: safeUser }; });
  app.post('/auth/logout', async (request, reply) => { const tokenHash = sessionHash(request); if (tokenHash) await repository.revokeSession(tokenHash); reply.clearCookie(COOKIE, { path: '/' }); return reply.code(204).send(); });
  app.get('/me', { preHandler: authenticate }, async request => ({ user: (request as AuthedRequest).currentUser }));

  app.get('/users/search', { preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => { const parsed = z.object({ q: z.string().trim().min(2).max(32) }).safeParse(request.query); if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' }); const user = (request as AuthedRequest).currentUser; return { users: await repository.searchUsers(normalizeUsername(parsed.data.q), user.id, 12) }; });
  app.get('/conversations', { preHandler: authenticate }, async request => ({ conversations: await repository.listConversations((request as AuthedRequest).currentUser.id) }));
  app.post('/conversations', { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => { const parsed = conversationInput.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' }); const conversation = await repository.createDirectConversation((request as AuthedRequest).currentUser.id, parsed.data.peerUserId); return conversation ? reply.code(201).send({ conversation }) : reply.code(404).send({ error: 'user_not_found' }); });
  app.get('/conversations/:id/messages', { preHandler: authenticate }, async (request, reply) => { const params = uuidParams.safeParse(request.params); const query = z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query); if (!params.success || !query.success) return reply.code(400).send({ error: 'invalid_input' }); const user = (request as AuthedRequest).currentUser; if (!(await repository.isConversationMember(params.data.id, user.id))) return reply.code(404).send({ error: 'conversation_not_found' }); return { messages: await repository.listEncryptedMessages(params.data.id, query.data.before ?? null, query.data.limit) }; });
  app.post('/conversations/:id/messages', { preHandler: authenticate, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => { const params = uuidParams.safeParse(request.params); const body = envelopeInput.safeParse(request.body); if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_envelope' }); const message = await repository.createEncryptedMessage((request as AuthedRequest).currentUser.id, { conversationId: params.data.id, ...body.data }); if (!message) return reply.code(404).send({ error: 'conversation_or_device_not_found' }); await broadcast(params.data.id, { type: 'message.created', message }); return reply.code(201).send({ message }); });

  app.post('/e2ee/devices', { preHandler: authenticate }, async (request, reply) => { const parsed = z.object({ deviceId: deviceId.optional(), encryptedDeviceName: z.string().max(1024).optional(), deviceType: z.literal('web').optional() }).strict().safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'invalid_device' }); try { return reply.code(201).send({ deviceId: await repository.registerProtocolDevice((request as AuthedRequest).currentUser.id, parsed.data.deviceId, parsed.data.encryptedDeviceName) }); } catch (error) { if ((error as Error).message === 'device_limit') return reply.code(409).send({ error: 'device_limit' }); throw error; } });
  app.get('/e2ee/users/:id/devices', { preHandler: authenticate }, async (request, reply) => { const params = uuidParams.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_user' }); return { devices: await repository.listProtocolDevices(params.data.id) }; });
  app.post('/e2ee/identity', { preHandler: authenticate }, async (request, reply) => { const parsed = z.object({ userId: z.string().uuid(), deviceId, registrationId: z.number().int().nonnegative(), identityType: identityType.optional(), identity: publicIdentity }).strict().safeParse(request.body); const user = (request as AuthedRequest).currentUser; if (!parsed.success || parsed.data.userId !== user.id) return reply.code(400).send({ error: 'invalid_identity' }); const result = await repository.provisionPublicIdentity(user.id, parsed.data.deviceId, parsed.data.registrationId, parsed.data.identityType ?? 'aci', parsed.data.identity); return result === 'conflict' ? reply.code(409).send({ error: 'identity_conflict' }) : reply.code(204).send(); });
  app.get('/e2ee/users/:id/identity', { preHandler: authenticate }, async (request, reply) => { const params = uuidParams.safeParse(request.params); const query = z.object({ identityType: identityType.optional() }).safeParse(request.query); if (!params.success || !query.success) return reply.code(400).send({ error: 'invalid_input' }); return { identity: await repository.getPublicIdentity(params.data.id, query.data.identityType ?? 'aci') }; });
  app.post('/e2ee/prekeys', { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => { const parsed = z.object({ userId: z.string().uuid(), deviceId, identityType: identityType.optional(), keys: z.array(preKey).min(1).max(250) }).strict().safeParse(request.body); const user = (request as AuthedRequest).currentUser; if (!parsed.success || parsed.data.userId !== user.id) return reply.code(400).send({ error: 'invalid_prekeys' }); const stored = await repository.uploadPreKeys(user.id, parsed.data.deviceId, parsed.data.identityType ?? 'aci', parsed.data.keys); return stored ? reply.code(204).send() : reply.code(404).send({ error: 'device_not_found' }); });
  app.get('/e2ee/prekeys/inventory', { preHandler: authenticate }, async (request, reply) => { const query = z.object({ deviceId: z.coerce.number().int().min(1).max(5), identityType: identityType.optional() }).safeParse(request.query); if (!query.success) return reply.code(400).send({ error: 'invalid_input' }); const inventory = await repository.getPreKeyInventory((request as AuthedRequest).currentUser.id, query.data.deviceId, query.data.identityType ?? 'aci'); return inventory ? { inventory } : reply.code(404).send({ error: 'device_not_found' }); });
  app.post('/e2ee/users/:id/devices/:deviceId/prekey-bundle', { preHandler: authenticate }, async (request, reply) => { const params = z.object({ id: z.string().uuid(), deviceId: z.coerce.number().int().min(1).max(5) }).safeParse(request.params); const body = z.object({ identityType: identityType.optional() }).safeParse(request.body ?? {}); if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_input' }); const bundle = await repository.fetchPreKeyBundle((request as AuthedRequest).currentUser.id, params.data.id, params.data.deviceId, body.data.identityType ?? 'aci'); return bundle ? { bundle } : reply.code(404).send({ error: 'bundle_not_found' }); });
  app.post('/e2ee/envelopes', { preHandler: authenticate, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => { const parsed = relayEnvelope.safeParse(request.body); const user = (request as AuthedRequest).currentUser; if (!parsed.success || parsed.data.senderUserId !== user.id) return reply.code(400).send({ error: 'invalid_envelope' }); const envelope = await repository.createRelayEnvelope(user.id, parsed.data); if (!envelope) return reply.code(404).send({ error: 'recipient_or_conversation_not_found' }); sendToUser(envelope.targetUserId, { type: 'e2ee.envelope', envelope }); return reply.code(201).send({ messageId: envelope.id, serverTimestamp: envelope.serverTimestamp }); });
  app.get('/e2ee/mailbox', { preHandler: authenticate }, async (request, reply) => { const query = z.object({ deviceId: z.coerce.number().int().min(1).max(5) }).safeParse(request.query); if (!query.success) return reply.code(400).send({ error: 'invalid_device' }); return { envelopes: await repository.listPendingEnvelopes((request as AuthedRequest).currentUser.id, query.data.deviceId) }; });
  app.post('/e2ee/envelopes/:id/delivered', { preHandler: authenticate }, async (request, reply) => { const params = uuidParams.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_envelope' }); return await repository.markEnvelopeDelivered((request as AuthedRequest).currentUser.id, params.data.id) ? reply.code(204).send() : reply.code(404).send({ error: 'envelope_not_found' }); });

  app.register(async realtimeApp => {
    realtimeApp.get('/realtime', { websocket: true }, (socket, request) => {
      const userPromise = resolveUser(request);
      socket.on('message', async (data: { toString(): string }) => { const user = await userPromise; if (user && data.toString() === '{"type":"ping"}') socket.send('{"type":"pong"}'); });
      void (async () => {
        if (request.headers.origin !== config.WEB_ORIGIN) return socket.close(1008, 'origin rejected'); const user = await userPromise; if (!user) return socket.close(1008, 'unauthorized');
        const set = connections.get(user.id) ?? new Set(); set.add(socket); connections.set(user.id, set); socket.send(JSON.stringify({ type: 'realtime.ready' }));
        socket.on('close', () => { set.delete(socket); if (set.size === 0) connections.delete(user.id); });
      })().catch(() => socket.close(1011, 'initialization failed'));
    });
  });
  return app;
}
