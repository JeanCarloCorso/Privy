export type User = { id: string; username: string; displayName: string; createdAt: string };
export type Conversation = { id: string; createdAt: string; peer: User };
const base = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
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
  searchUsers: (query: string) => request<{ users: User[] }>(`/users/search?q=${encodeURIComponent(query)}`),
  conversations: () => request<{ conversations: Conversation[] }>('/conversations'),
  createConversation: (peerUserId: string) => request<{ conversation: Conversation }>('/conversations', { method: 'POST', body: JSON.stringify({ peerUserId }) }),
  realtimeUrl: () => `${base.replace(/^http/, 'ws')}/realtime`,
};
