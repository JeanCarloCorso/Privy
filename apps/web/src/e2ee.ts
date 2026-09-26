import { createSignalProtocolClient, ProtocolAddress, type Ciphertext, type DecryptedEnvelope, type DefaultSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import { IndexedDbSignalProtocolStore } from '@open-e2ee/signal-protocol-sdk/local/store/web';
import type { AccountIdentityProvisioning, DeviceInfo, DeviceRegistration, Envelope, PreKeyBundle, PreKeyInventory, PreKeyUpload, SignalProtocolRelayServer } from '@open-e2ee/signal-protocol-sdk/remote/relay';
import type { CompositeIdentityV1, IdentityType } from '@open-e2ee/signal-protocol-sdk/keys/types';
import { api, request } from './api';

const toBase64 = (value: Uint8Array | string) => {
  if (typeof value === 'string') return value;
  let binary = '';
  for (let offset = 0; offset < value.length; offset += 0x8000) binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  return btoa(binary);
};
const unsupported = async (): Promise<never> => { throw new Error('Recurso de grupos ou vinculação de dispositivo ainda não disponível'); };

class PrivyRelay {
  private sockets = new Set<WebSocket>();
  async send(envelope: Envelope) { return request<{ messageId: string; serverTimestamp: number }>('/e2ee/envelopes', { method: 'POST', body: JSON.stringify({ ...envelope, ciphertext: toBase64(envelope.ciphertext), clientMessageId: envelope.clientMessageId ?? crypto.randomUUID() }) }); }
  subscribe(_userId: string, deviceId: number, onEnvelope: (envelope: Envelope) => void) {
    const deliver = (raw: Envelope & { ciphertext: string }) => onEnvelope(raw);
    const socket = new WebSocket(api.realtimeUrl()); this.sockets.add(socket);
    socket.addEventListener('open', () => { void request<{ envelopes: Array<Envelope & { ciphertext: string }> }>(`/e2ee/mailbox?deviceId=${deviceId}`).then(result => result.envelopes.forEach(deliver)); });
    socket.addEventListener('message', event => { try { const message = JSON.parse(String(event.data)) as { type?: string; envelope?: Envelope & { ciphertext: string } }; if (message.type === 'e2ee.envelope' && message.envelope?.targetDeviceId === deviceId) deliver(message.envelope); } catch { /* malformed transport events are ignored */ } });
    return () => { this.sockets.delete(socket); socket.close(); };
  }
  async markDelivered(envelopeId: string) { await request<void>(`/e2ee/envelopes/${envelopeId}/delivered`, { method: 'POST' }); }
  async getDevices(userId: string) { return (await request<{ devices: DeviceInfo[] }>(`/e2ee/users/${userId}/devices`)).devices; }
  async registerDevice(_userId: string, device: DeviceRegistration) { return (await request<{ deviceId: number }>('/e2ee/devices', { method: 'POST', body: JSON.stringify({ ...device, encryptedDeviceName: device.encryptedDeviceName ? toBase64(new Uint8Array(device.encryptedDeviceName)) : undefined, deviceType: 'web' }) })).deviceId; }
  async removeDevice() { return unsupported(); }
  async provisionIdentityKey(value: AccountIdentityProvisioning) { await request<void>('/e2ee/identity', { method: 'POST', body: JSON.stringify(value) }); }
  async rotateIdentityKey() { return unsupported(); }
  async getIdentityKey(userId: string, identityType: IdentityType = 'aci') { return (await request<{ identity: CompositeIdentityV1 | null }>(`/e2ee/users/${userId}/identity?identityType=${identityType}`)).identity; }
  async uploadPreKeys(userId: string, deviceId: number, keys: PreKeyUpload[], identityType: IdentityType = 'aci') { await request<void>('/e2ee/prekeys', { method: 'POST', body: JSON.stringify({ userId, deviceId, keys, identityType }) }); }
  async fetchPreKeyBundle(userId: string, deviceId: number, _fetcher?: string, identityType: IdentityType = 'aci') { return (await request<{ bundle: PreKeyBundle }>(`/e2ee/users/${userId}/devices/${deviceId}/prekey-bundle`, { method: 'POST', body: JSON.stringify({ identityType }) })).bundle; }
  async getPreKeyInventory(_userId: string, deviceId: number, identityType: IdentityType = 'aci') { return (await request<{ inventory: PreKeyInventory }>(`/e2ee/prekeys/inventory?deviceId=${deviceId}&identityType=${identityType}`)).inventory; }
  async getPreKeyCount(userId: string, deviceId: number, type: 'ec' | 'kem', identityType: IdentityType = 'aci') { const inventory = await this.getPreKeyInventory(userId, deviceId, identityType); return type === 'ec' ? inventory.ecOneTimePreKeyCount : inventory.kemOneTimePreKeyCount; }
  async publishPlannedPreKeys(userId: string, deviceId: number, plan: (inventory: PreKeyInventory) => Promise<readonly PreKeyUpload[]>, identityType: IdentityType = 'aci') { const keys = await plan(await this.getPreKeyInventory(userId, deviceId, identityType)); if (keys.length) await this.uploadPreKeys(userId, deviceId, [...keys], identityType); }
  async clearStaleKemPreKeys() { return { cleared: 0 }; }
  async getEcSignedPreKeyMetadata(userId: string, deviceId: number, identityType: IdentityType = 'aci') { return (await this.getPreKeyInventory(userId, deviceId, identityType)).ecSignedPreKey; }
  async getKemLastResortPreKeyMetadata(userId: string, deviceId: number, identityType: IdentityType = 'aci') { return (await this.getPreKeyInventory(userId, deviceId, identityType)).kemLastResortPreKey; }
  async getActiveDevices(userId: string) { return (await this.getDevices(userId)).filter(item => item.enabled && item.registered).map(item => ({ userId, deviceId: item.deviceId })); }
  createProvisioningSession = unsupported; connectNewDevice = unsupported; sendProvisioningMessage = unsupported; getProvisioningMessage = unsupported; completeProvisioning = unsupported; acknowledgeProvisioning = unsupported; rollbackProvisioning = unsupported; deleteProvisioningSession = unsupported;
}

const clientRelays = new WeakMap<DefaultSignalProtocolClient, PrivyRelay>();

export async function createPrivyE2EE(userId: string, onMessage: (message: DecryptedEnvelope) => void | Promise<void>): Promise<DefaultSignalProtocolClient> {
  const legacyOwnerKey = 'privy:e2ee:legacy-owner';
  const legacyOwner = localStorage.getItem(legacyOwnerKey);
  if (!legacyOwner) localStorage.setItem(legacyOwnerKey, userId);
  const storage = new IndexedDbSignalProtocolStore();
  if (legacyOwner && legacyOwner !== userId) (storage as unknown as { dbName: string }).dbName = `signal-protocol-storage-${userId}`;
  await storage.initialize();
  const relay = new PrivyRelay();
  await relay.registerDevice(userId, { deviceId: 1, deviceType: 'web' });
  const client = await createSignalProtocolClient({ identity: { userId, deviceId: 1 }, adapters: { storage, relay: relay as unknown as SignalProtocolRelayServer } });
  clientRelays.set(client, relay);
  const unsubscribe = relay.subscribe(userId, 1, async envelope => {
    try {
      const content = await client.decryptMessage(ProtocolAddress.create(envelope.senderUserId, envelope.senderDeviceId), envelope.ciphertext as Ciphertext);
      await onMessage({ messageId: envelope.id ?? envelope.clientMessageId ?? crypto.randomUUID(), sessionId: `${envelope.senderUserId}.${envelope.senderDeviceId}`, senderId: envelope.senderUserId, senderDeviceId: envelope.senderDeviceId, conversationId: envelope.senderUserId, content, timestamp: envelope.timestamp, serverTimestamp: envelope.serverTimestamp, receivedAt: Date.now(), isGroup: false, messageType: envelope.messageType });
      if (envelope.id) await relay.markDelivered(envelope.id);
    } catch (error) { console.error('E2EE receive failed', error); }
  });
  client.stopRelaySubscription = unsubscribe;
  return client;
}

export async function sendPrivyMessage(client: DefaultSignalProtocolClient, recipientUserId: string, content: string) {
  const relay = clientRelays.get(client); if (!relay) throw new Error('E2EE relay unavailable');
  const devices = (await relay.getDevices(recipientUserId)).filter(device => device.enabled && device.registered);
  if (!devices.length) throw new Error(`Recipient ${recipientUserId} has no available prekey bundles`);
  for (const device of devices) {
    const address = ProtocolAddress.create(recipientUserId, device.deviceId); const existing = await client.hasSession(address);
    if (!existing) await client.establishSession(address, await relay.fetchPreKeyBundle(recipientUserId, device.deviceId));
    const ciphertext = await client.encryptMessage(address, content);
    const initiatedKey = `privy:e2ee:initiated:${client.userId}:${recipientUserId}:${device.deviceId}`;
    await relay.send({ targetUserId: recipientUserId, targetDeviceId: device.deviceId, senderUserId: client.userId, senderDeviceId: client.deviceId, ciphertext, messageType: localStorage.getItem(initiatedKey) ? 'ciphertext' : 'prekey_bundle', deliveryClass: 'user-visible', timestamp: Date.now(), clientMessageId: crypto.randomUUID() });
    localStorage.setItem(initiatedKey, '1');
  }
}
