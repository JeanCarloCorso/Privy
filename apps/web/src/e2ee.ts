import { createSignalProtocolClient, type DecryptedEnvelope, type DefaultSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import { indexedDbStore } from '@open-e2ee/signal-protocol-sdk/local/store/web';
import type { AccountIdentityProvisioning, DeviceInfo, DeviceRegistration, Envelope, PreKeyBundle, PreKeyInventory, PreKeyUpload, SignalProtocolRelayServer } from '@open-e2ee/signal-protocol-sdk/remote/relay';
import type { CompositeIdentityV1, IdentityType } from '@open-e2ee/signal-protocol-sdk/keys/types';
import { api, request } from './api';

const toBase64 = (value: Uint8Array | string) => {
  if (typeof value === 'string') return value;
  let binary = '';
  for (let offset = 0; offset < value.length; offset += 0x8000) binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  return btoa(binary);
};
const fromBase64 = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const unsupported = async (): Promise<never> => { throw new Error('Recurso de grupos ou vinculação de dispositivo ainda não disponível'); };

class PrivyRelay {
  private sockets = new Set<WebSocket>();
  async send(envelope: Envelope) { return request<{ messageId: string; serverTimestamp: number }>('/e2ee/envelopes', { method: 'POST', body: JSON.stringify({ ...envelope, ciphertext: toBase64(envelope.ciphertext), clientMessageId: envelope.clientMessageId ?? crypto.randomUUID() }) }); }
  subscribe(_userId: string, deviceId: number, onEnvelope: (envelope: Envelope) => void) {
    const deliver = (raw: Envelope & { ciphertext: string }) => onEnvelope({ ...raw, ciphertext: fromBase64(raw.ciphertext) });
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

export async function createPrivyE2EE(userId: string, onMessage: (message: DecryptedEnvelope) => void): Promise<DefaultSignalProtocolClient> {
  const storage = await indexedDbStore();
  const client = await createSignalProtocolClient({ identity: { userId, deviceId: 1 }, adapters: { storage, relay: new PrivyRelay() as unknown as SignalProtocolRelayServer }, hooks: { onMessageDecrypted: onMessage } });
  await client.syncToServer();
  client.startRelaySubscription();
  return client;
}
