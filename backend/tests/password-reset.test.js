process.env.PASSWORD_RESET_EMAIL_ENABLED = 'false';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const crypto = require('node:crypto');
const express = require('express');
const errorHandler = require('../src/middleware/errorHandler');
const authRoutes = require('../src/routes/auth.routes');
const passwordResetRepository = require('../src/repositories/passwordResetRepository');
const userRepository = require('../src/repositories/userRepository');
const {
  createPasswordResetToken,
  hashPasswordResetToken,
} = require('../src/utils/passwordResetToken');

const originalFindByEmail = userRepository.findByEmail;
const originalIsValid = passwordResetRepository.isValid;
let server;
let baseUrl;
let userLookupCalls;

before(async () => {
  userLookupCalls = 0;
  userRepository.findByEmail = async () => {
    userLookupCalls += 1;
    return null;
  };
  passwordResetRepository.isValid = async () => false;

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

after(async () => {
  userRepository.findByEmail = originalFindByEmail;
  passwordResetRepository.isValid = originalIsValid;
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('password reset tokens are random hex values and are stored as SHA-256 hashes', () => {
  const first = createPasswordResetToken();
  const second = createPasswordResetToken();

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.equal(
    hashPasswordResetToken(first),
    crypto.createHash('sha256').update(first).digest('hex')
  );
  assert.notEqual(hashPasswordResetToken(first), first);
});

test('password reset requests stay disabled by default without looking up accounts', async () => {
  const response = await fetch(`${baseUrl}/password-reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@example.com' }),
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.message, /not enabled/i);
  assert.equal(userLookupCalls, 0);
});

test('malformed reset tokens are rejected before repository access', async () => {
  const response = await fetch(`${baseUrl}/password-reset/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'not-a-token' }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
});
