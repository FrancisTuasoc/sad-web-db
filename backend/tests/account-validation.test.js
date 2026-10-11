const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  isValidCustomerAccount,
  isValidEmailAddress,
} = require('../src/utils/accountValidation');

test('customer accounts can use non-Gmail email addresses', () => {
  assert.equal(isValidEmailAddress('customer@example.com'), true);
  assert.equal(
    isValidCustomerAccount({
      role: 'customer',
      username: 'customer1',
      email: 'customer@example.com',
    }),
    true
  );
});

test('customer account validation still rejects malformed email and username', () => {
  assert.equal(isValidEmailAddress('invalid-email'), false);
  assert.equal(
    isValidCustomerAccount({
      role: 'customer',
      username: '1invalid',
      email: 'customer@example.com',
    }),
    false
  );
});
