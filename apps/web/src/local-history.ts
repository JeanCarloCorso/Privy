export type LocalMessage = { id: string; peerId: string; body: string; mine: boolean; timestamp: number };

const DATABASE = 'privy-private-history-v1';
const KEY_STORE = 'keys';
const MESSAGE_STORE = 'messages';

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(KEY_STORE)) database.createObjectStore(KEY_STORE);
    if (!database.objectStoreNames.contains(MESSAGE_STORE)) database.createObjectStore(MESSAGE_STORE, { keyPath: 'storageId' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transactionRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });

async function historyKey(database: IDBDatabase, userId: string) {
  const current = await transactionRequest(database.transaction(KEY_STORE).objectStore(KEY_STORE).get(userId)) as CryptoKey | undefined;
  if (current) return current;
  const generated = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await transactionRequest(database.transaction(KEY_STORE, 'readwrite').objectStore(KEY_STORE).put(generated, userId));
  return generated;
}

export async function saveLocalMessage(userId: string, message: LocalMessage) {
  const database = await openDatabase();
  try {
    const key = await historyKey(database, userId); const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(message));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(userId) }, key, plaintext);
    await transactionRequest(database.transaction(MESSAGE_STORE, 'readwrite').objectStore(MESSAGE_STORE).put({ storageId: `${userId}:${message.id}`, userId, iv, ciphertext }));
  } finally { database.close(); }
}

export async function loadLocalMessages(userId: string): Promise<LocalMessage[]> {
  const database = await openDatabase();
  try {
    const key = await historyKey(database, userId); const rows = await transactionRequest(database.transaction(MESSAGE_STORE).objectStore(MESSAGE_STORE).getAll()) as Array<{ userId: string; iv: Uint8Array; ciphertext: ArrayBuffer }>;
    const output: LocalMessage[] = [];
    for (const row of rows.filter(item => item.userId === userId)) {
      try { const iv = new Uint8Array(row.iv.byteLength); iv.set(row.iv); const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(userId) }, key, row.ciphertext); output.push(JSON.parse(new TextDecoder().decode(plaintext)) as LocalMessage); } catch { /* corrupted local records fail closed */ }
    }
    return output.sort((a, b) => a.timestamp - b.timestamp);
  } finally { database.close(); }
}
