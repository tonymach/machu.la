// Encrypts adventure.log.json -> adventure.data.json for /adventure.
// Usage: node adventure.encrypt.mjs <password>
// Commit adventure.data.json; adventure.log.json stays gitignored.
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const pw = process.argv[2];
if (!pw) { console.error('usage: node adventure.encrypt.mjs <password>'); process.exit(1); }

const data = new TextEncoder().encode(readFileSync('adventure.log.json', 'utf8'));
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
  km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
const b64 = u8 => Buffer.from(u8).toString('base64');
writeFileSync('adventure.data.json', JSON.stringify({ salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
console.log('wrote adventure.data.json (' + ct.length + ' bytes ciphertext)');
