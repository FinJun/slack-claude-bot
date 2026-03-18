import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { encrypt, decrypt } from '../../src/utils/crypto.js';

function randomKey(): string {
  return randomBytes(32).toString('hex');
}

describe('crypto encrypt/decrypt', () => {
  it('round-trips plaintext correctly', () => {
    const key = randomKey();
    const plaintext = 'sk-ant-api-key-test-1234';
    const enc = encrypt(plaintext, key);
    expect(decrypt(enc, key)).toBe(plaintext);
  });

  it('produces different ciphertext for same input (random IV)', () => {
    const key = randomKey();
    const plaintext = 'same-plaintext';
    const enc1 = encrypt(plaintext, key);
    const enc2 = encrypt(plaintext, key);
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.encrypted).not.toBe(enc2.encrypted);
  });

  it('round-trips empty string', () => {
    const key = randomKey();
    const enc = encrypt('', key);
    expect(decrypt(enc, key)).toBe('');
  });

  it('round-trips unicode / special chars', () => {
    const key = randomKey();
    const plaintext = 'hello 世界 🔐 \n tab\there';
    const enc = encrypt(plaintext, key);
    expect(decrypt(enc, key)).toBe(plaintext);
  });

  it('throws when decrypting with wrong key', () => {
    const key = randomKey();
    const wrongKey = randomKey();
    const enc = encrypt('secret', key);
    expect(() => decrypt(enc, wrongKey)).toThrow();
  });

  it('throws when authTag is tampered', () => {
    const key = randomKey();
    const enc = encrypt('secret', key);
    const tampered = { ...enc, authTag: 'deadbeef'.repeat(4) };
    expect(() => decrypt(tampered, key)).toThrow();
  });
});
