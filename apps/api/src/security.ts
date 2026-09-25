import { createHmac, randomBytes } from 'node:crypto';
import { hash, verify, Algorithm } from '@node-rs/argon2';

export const normalizeUsername = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en-US');
export const hashPassword = (password: string) => hash(password, { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 });
export const verifyPassword = (encoded: string, password: string) => verify(encoded, password);
export const newSessionToken = () => randomBytes(32).toString('base64url');
export const hashSessionToken = (token: string, pepper: string) => createHmac('sha256', pepper).update(token).digest('hex');
