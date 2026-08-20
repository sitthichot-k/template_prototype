'use strict';

/**
 * Cryptographic primitives used across the platform.
 *
 * Centralised so the algorithm choices are made once and can be audited in
 * one file, and so a future migration (for example to a KMS) touches one
 * module instead of every call site.
 */

const crypto = require('crypto');
const argon2 = require('argon2');
const config = require('../../../config');

// OWASP-aligned argon2id parameters. Raising memoryCost is the cheapest way
// to stay ahead of GPU cracking; revisit these numbers annually.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1
};

const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** Derives a stable 32-byte key from the configured secret. */
function encryptionKey() {
  return crypto.createHash('sha256').update(config.crypto.encryptionKey).digest();
}

// --- Passwords ---------------------------------------------------------------

async function hashPassword(plain) {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/**
 * Verifies a password. Returns false on a malformed hash rather than throwing,
 * so a corrupted record cannot be distinguished from a wrong password.
 */
async function verifyPassword(hash, plain) {
  if (!hash || !plain) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * True when the stored hash was produced with weaker parameters than the
 * current policy, so it can be transparently upgraded on next login.
 */
function needsRehash(hash) {
  if (!hash) return true;
  try {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  } catch {
    return true;
  }
}

// --- Tokens ------------------------------------------------------------------

/** Cryptographically random URL-safe token (refresh tokens, invite links). */
function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * SHA-256 of an opaque token. Refresh tokens and API keys are stored hashed:
 * a database leak then yields nothing usable. SHA-256 (not argon2) is correct
 * here because the input already has full entropy.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison, for any secret compared against user input. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// --- Symmetric encryption ----------------------------------------------------

/**
 * Encrypts a value for storage. Used for settings flagged `secret: true`
 * (SMTP passwords, third-party API keys) so they are not readable straight
 * out of a database dump.
 *
 * @returns {string} `v1:<iv>:<authTag>:<ciphertext>`, all base64url.
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(AES_ALGORITHM, encryptionKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

/** Inverse of `encrypt`. Throws if the ciphertext was tampered with. */
function decrypt(payload) {
  if (!payload) return '';
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unrecognised ciphertext format');
  }
  const [, ivPart, tagPart, dataPart] = parts;
  const decipher = crypto.createDecipheriv(
    AES_ALGORITHM,
    encryptionKey(),
    Buffer.from(ivPart, 'base64url'),
    { authTagLength: AUTH_TAG_LENGTH }
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith('v1:') && value.split(':').length === 4;
}

module.exports = {
  hashPassword,
  verifyPassword,
  needsRehash,
  randomToken,
  hashToken,
  safeEqual,
  encrypt,
  decrypt,
  isEncrypted
};
