export type User = { id: string; username: string; displayName: string; createdAt: string; avatarUpdatedAt: string | null };
export type Conversation = { id: string; createdAt: string; peer: User };
// Development always follows the API port defined by the local project. This
// avoids a stale Vite process retaining an old VITE_API_URL after .env changes.
const base = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:3000` : (import.meta.env.VITE_API_URL || '/api');
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...init, credentials: 'include', headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'request_failed');
  return response.status === 204 ? undefined as T : response.json();
}
export const api = {
  me: () => request<{ user: User }>('/me'),
  register: (body: { username: string; displayName: string; password: string }) => request<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { username: string; password: string }) => request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  uploadAvatar: (mime: 'image/jpeg' | 'image/png' | 'image/webp', data: string) => request<{ user: User }>('/me/avatar', { method: 'PUT', body: JSON.stringify({ mime, data }) }),
  avatarUrl: (user: User) => user.avatarUpdatedAt ? `${base}/users/${user.id}/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}` : '',
  searchUsers: (query: string) => request<{ users: User[] }>(`/users/search?q=${encodeURIComponent(query)}`),
  conversations: () => request<{ conversations: Conversation[] }>('/conversations'),
  createConversation: (peerUserId: string) => request<{ conversation: Conversation }>('/conversations', { method: 'POST', body: JSON.stringify({ peerUserId }) }),
  publicIdentity: (userId: string) => request<{ identity: { version: 1; x25519PublicKey: string; ed25519PublicKey: string } | null }>(`/e2ee/users/${userId}/identity?identityType=aci`),
  iceServers: () => request<{ iceServers: RTCIceServer[]; expiresIn: number }>('/calls/ice-servers'),
  realtimeUrl: () => `${base.replace(/^http/, 'ws')}/realtime`,
};
