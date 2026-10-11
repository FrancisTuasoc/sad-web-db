const assert = require('node:assert/strict');
const { test } = require('node:test');
const sendVerificationEmail = require('../src/utils/verificationEmail');
const createVerificationToken = require('../src/utils/verificationToken');

test('verification token uses 32 secure random bytes represented as hex', () => {
  const first = createVerificationToken();
  const second = createVerificationToken();

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

test('verification email uses the Brevo REST API and configured sender', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.BREVO_API_KEY;
  const originalSender = process.env.BREVO_SENDER_EMAIL;
  let request;
  process.env.BREVO_API_KEY = 'test-brevo-key';
  process.env.BREVO_SENDER_EMAIL = 'shop@example.com';
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ messageId: 'test-message' }) };
  };

  try {
    const result = await sendVerificationEmail(
      'customer@example.com',
      'https://shop.example/verify-email.html?token=abc'
    );

    assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers['api-key'], 'test-brevo-key');
    assert.equal(request.options.headers['Content-Type'], 'application/json');
    const body = JSON.parse(request.options.body);
    assert.deepEqual(
      {
        sender: body.sender,
        to: body.to,
        subject: body.subject,
      },
      {
      sender: { email: 'shop@example.com' },
      to: [{ email: 'customer@example.com' }],
      subject: 'Verify your email address',
      }
    );
    assert.match(
      body.htmlContent,
      /https:\/\/shop\.example\/verify-email\.html\?token=abc/
    );
    assert.deepEqual(result, { messageId: 'test-message' });
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = originalApiKey;
    if (originalSender === undefined) delete process.env.BREVO_SENDER_EMAIL;
    else process.env.BREVO_SENDER_EMAIL = originalSender;
  }
});

test('verification email reports Brevo API failures', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    json: async () => ({ message: 'Rejected sender' }),
  });

  try {
    await assert.rejects(
      sendVerificationEmail(
        'customer@example.com',
        'https://shop.example/verify-email.html?token=abc'
      ),
      /Brevo email failed: .*Rejected sender/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
