process.env.PASSWORD_RESET_EMAIL_ENABLED = 'true';
process.env.BREVO_API_KEY = 'test-key';
process.env.BREVO_SENDER_EMAIL = 'recovery@example.test';
process.env.FRONTEND_URL = 'https://frontend.example.test';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const bcrypt = require('bcryptjs');
const express = require('express');
const errorHandler = require('../src/middleware/errorHandler');
const authRoutes = require('../src/routes/auth.routes');
const passwordResetRepository = require('../src/repositories/passwordResetRepository');
const userRepository = require('../src/repositories/userRepository');
const { hashPasswordResetToken } = require('../src/utils/passwordResetToken');

const localFetch = global.fetch;
const originals = {
  fetch: global.fetch,
  findByEmail: userRepository.findByEmail,
  createOrReplace: passwordResetRepository.createOrReplace,
  isValid: passwordResetRepository.isValid,
  resetPassword: passwordResetRepository.resetPassword,
};

let server;
let baseUrl;
let sentEmail;
let savedTokenHash;
let savedPasswordHash;
let validTokenHash;

before(async () => {
  sentEmail = null;
  savedTokenHash = null;
  savedPasswordHash = null;
  validTokenHash = null;
  userRepository.findByEmail = async (email) => ({
    id: 'test-user',
    email,
    isVerified: true,
  });
  passwordResetRepository.createOrReplace = async (userId, tokenHash) => {
    assert.equal(userId, 'test-user');
    savedTokenHash = tokenHash;
    return { status: 'created' };
  };
  passwordResetRepository.isValid = async (tokenHash) =>
    tokenHash === validTokenHash;
  passwordResetRepository.resetPassword = async (tokenHash, passwordHash) => {
    if (tokenHash !== validTokenHash) return { status: 'not_found' };
    savedPasswordHash = passwordHash;
    return { status: 'reset' };
  };
  global.fetch = async (url, options) => {
    sentEmail = { url, options };
    return { ok: true, json: async () => ({ messageId: 'mock-only' }) };
  };

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

after(async () => {
  global.fetch = originals.fetch;
  userRepository.findByEmail = originals.findByEmail;
  passwordResetRepository.createOrReplace = originals.createOrReplace;
  passwordResetRepository.isValid = originals.isValid;
  passwordResetRepository.resetPassword = originals.resetPassword;
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('eligible reset requests email a one-time link while storing only its hash', async () => {
  const response = await localFetch(`${baseUrl}/password-reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@example.test' }),
  });
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.success, true);
  assert.equal(sentEmail.url, 'https://api.brevo.com/v3/smtp/email');
  const emailPayload = JSON.parse(sentEmail.options.body);
  assert.equal(emailPayload.to[0].email, 'customer@example.test');
  const resetLink = emailPayload.htmlContent.match(
    /href="(https:\/\/frontend\.example\.test\/reset-password\.html\?token=([a-f0-9]{64}))"/
  );
  assert.ok(resetLink);
  validTokenHash = hashPasswordResetToken(resetLink[2]);
  assert.equal(savedTokenHash, validTokenHash);
  assert.match(emailPayload.htmlContent, /expires in 30 minutes/i);
  assert.match(emailPayload.htmlContent, /only be used once/i);
});

test('validates and consumes a reset token while saving a bcrypt password hash', async () => {
  const token = 'a'.repeat(64);
  validTokenHash = hashPasswordResetToken(token);

  const validation = await localFetch(`${baseUrl}/password-reset/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  assert.equal(validation.status, 200);

  const reset = await localFetch(`${baseUrl}/password-reset/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      password: 'NewPassword123',
      confirmPassword: 'NewPassword123',
    }),
  });
  const body = await reset.json();

  assert.equal(reset.status, 200);
  assert.equal(body.success, true);
  assert.equal(await bcrypt.compare('NewPassword123', savedPasswordHash), true);
  assert.notEqual(savedPasswordHash, 'NewPassword123');
});

test('uses PASSWORD_RESET_API_KEY when configured with the same sender email', async () => {
  const previousResetKey = process.env.PASSWORD_RESET_API_KEY;
  const previousSender = process.env.BREVO_SENDER_EMAIL;
  process.env.PASSWORD_RESET_API_KEY = 'dedicated-reset-key';
  process.env.BREVO_SENDER_EMAIL = 'shop-sender@example.com';

  const sendPasswordResetEmail = require('../src/utils/passwordResetEmail');
  let capturedOptions;
  global.fetch = async (url, options) => {
    capturedOptions = options;
    return { ok: true, json: async () => ({ messageId: 'dedicated-test' }) };
  };

  try {
    await sendPasswordResetEmail(
      'customer@example.test',
      'https://frontend.example.test/reset-password.html?token=abc'
    );
    assert.equal(capturedOptions.headers['api-key'], 'dedicated-reset-key');
    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.sender.email, 'shop-sender@example.com');
  } finally {
    if (previousResetKey === undefined) {
      delete process.env.PASSWORD_RESET_API_KEY;
    } else {
      process.env.PASSWORD_RESET_API_KEY = previousResetKey;
    }
    process.env.BREVO_SENDER_EMAIL = previousSender;
  }
});
