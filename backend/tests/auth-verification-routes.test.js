const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const bcrypt = require('bcryptjs');
const express = require('express');
const errorHandler = require('../src/middleware/errorHandler');
const authRoutes = require('../src/routes/auth.routes');
const pendingVerificationRepository = require('../src/repositories/pendingVerificationRepository');
const userRepository = require('../src/repositories/userRepository');

const originals = {
  findByEmail: userRepository.findByEmail,
  findByUsername: userRepository.findByUsername,
  safeUser: userRepository.safeUser,
  findPendingUsername: pendingVerificationRepository.findPendingUsername,
  createOrReplace: pendingVerificationRepository.createOrReplace,
  cleanupExpired: pendingVerificationRepository.cleanupExpired,
  verifyToken: pendingVerificationRepository.verifyToken,
  fetch: global.fetch,
};

let server;
let baseUrl;
let pendingData;
let latestVerificationToken;
let currentUser;
let cleanupCall;
let userCreateCalls;
let resendResult;

before(async () => {
  userRepository.findByEmail = async () => null;
  userRepository.findByUsername = async () => null;
  userRepository.safeUser = (user) => user;
  pendingVerificationRepository.findPendingUsername = async () => false;
  pendingVerificationRepository.createOrReplace = async ({
    email,
    token,
    userData,
  }) => {
    latestVerificationToken = token;
    if (resendResult) return resendResult;
    pendingData = { email, userData };
    return { status: 'created' };
  };
  pendingVerificationRepository.cleanupExpired = async (options) => {
    cleanupCall = options;
    return 0;
  };
  pendingVerificationRepository.verifyToken = async (token) =>
    token === latestVerificationToken
      ? { status: 'verified', user: { id: 'verified-user' } }
      : { status: 'not_found' };
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.brevo.com/')) {
      return {
        ok: true,
        json: async () => ({ messageId: 'mock-message' }),
      };
    }
    return originals.fetch(url, options);
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
  userRepository.findByEmail = originals.findByEmail;
  userRepository.findByUsername = originals.findByUsername;
  userRepository.safeUser = originals.safeUser;
  pendingVerificationRepository.findPendingUsername =
    originals.findPendingUsername;
  pendingVerificationRepository.createOrReplace = originals.createOrReplace;
  pendingVerificationRepository.cleanupExpired = originals.cleanupExpired;
  pendingVerificationRepository.verifyToken = originals.verifyToken;
  global.fetch = originals.fetch;
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('registration stores a pending non-Gmail account and sends verification without logging in', async () => {
  let createCalls = 0;
  userRepository.create = async () => {
    createCalls += 1;
  };

  const response = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'outlookuser',
      email: 'customer@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.match(
    body.message,
    /A verification email has been sent to your inbox/
  );
  assert.equal(pendingData.email, 'customer@example.com');
  assert.equal(pendingData.userData.username, 'outlookuser');
  assert.equal(pendingData.userData.email, 'customer@example.com');
  assert.match(pendingData.userData.passwordHash, /^\$2[aby]\$/);
  assert.equal(createCalls, 0);
  assert.equal(body.token, undefined);
  assert.equal(body.user, undefined);
});

test('registration accepts firstName and lastName and generates a valid username', async () => {
  const response = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Maria',
      lastName: 'Santos',
      email: 'maria.santos@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.match(
    body.message,
    /A verification email has been sent to your inbox/
  );
  assert.equal(pendingData.email, 'maria.santos@example.com');
  assert.equal(pendingData.userData.firstName, 'Maria');
  assert.equal(pendingData.userData.lastName, 'Santos');
  assert.equal(pendingData.userData.fullName, 'Maria Santos');
  assert.equal(pendingData.userData.username, 'mariasantos');
  assert.match(pendingData.userData.passwordHash, /^\$2[aby]\$/);
});

test('verification status reports whether Brevo is configured', async () => {
  const response = await fetch(`${baseUrl}/verification-status`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(typeof body.verificationEnabled, 'boolean');
});

test('verification handler cleans expired records and returns success', async () => {
  const response = await fetch(
    `${baseUrl}/verify-email?token=${latestVerificationToken}`
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(cleanupCall.token, latestVerificationToken);
});

test('invalid verification links return a resend-ready error', async () => {
  const response = await fetch(`${baseUrl}/verify-email?token=${'a'.repeat(64)}`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.match(body.message, /invalid or has already been used/);
});

test('resend enforces the repository rate limit without sending an email', async () => {
  let emailSent = false;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.brevo.com/')) {
      emailSent = true;
      return { ok: true, json: async () => ({}) };
    }
    return originals.fetch(url, options);
  };
  resendResult = { status: 'rate_limited', retryAfter: 42 };

  const response = await fetch(`${baseUrl}/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@example.com' }),
  });
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.match(body.message, /42 seconds/);
  assert.equal(emailSent, false);
  assert.equal(cleanupCall.email, 'customer@example.com');
  resendResult = null;
});

test('login blocks unverified accounts and permits verified accounts', async () => {
  const passwordHash = await bcrypt.hash('password123', 4);
  currentUser = {
    id: 'customer-id',
    username: 'outlookuser',
    email: 'customer@example.com',
    passwordHash,
    role: 'customer',
    status: 'active',
    isVerified: false,
  };
  userRepository.findByEmail = async () => currentUser;

  const request = () =>
    fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'customer@example.com',
        password: 'password123',
      }),
    });

  const blocked = await request();
  assert.equal(blocked.status, 403);
  assert.match((await blocked.json()).message, /verify your email address/);

  currentUser.isVerified = true;
  const allowed = await request();
  const body = await allowed.json();
  assert.equal(allowed.status, 200);
  assert.equal(body.success, true);
  assert.ok(body.token);
});
