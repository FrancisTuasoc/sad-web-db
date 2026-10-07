const assert = require('node:assert/strict');
const { test } = require('node:test');
const checkoutSchema = require('../src/utils/checkoutValidation');
const User = require('../src/models/User');

function makeCheckout(fulfillment, overrides = {}) {
  return {
    cartItemIds: ['cart-item-id'],
    fulfillment,
    paymentMethod: fulfillment === 'delivery' ? 'cod' : 'pay_at_shop',
    contact: {
      firstName: 'Alex',
      lastName: 'Customer',
      email: 'alex@example.com',
      phone: '09171234567',
      street: '',
      barangay: '',
      city: '',
      province: '',
      postalCode: '',
      ...overrides,
    },
  };
}

test('pickup contact details do not require a delivery address', () => {
  assert.equal(checkoutSchema.safeParse(makeCheckout('pickup')).success, true);
});

test('delivery requires each structured address field and a four-digit postal code', () => {
  const validDelivery = makeCheckout('delivery', {
    street: '10 Main Street',
    barangay: 'Central',
    city: 'Manila',
    province: 'Metro Manila',
    postalCode: '1000',
  });
  assert.equal(checkoutSchema.safeParse(validDelivery).success, true);

  assert.equal(checkoutSchema.safeParse({
    ...validDelivery,
    contact: { ...validDelivery.contact, postalCode: '10000' },
  }).success, false);
  assert.equal(checkoutSchema.safeParse({
    ...validDelivery,
    contact: { ...validDelivery.contact, barangay: '' },
  }).success, false);
});

test('checkout requires first and last name and a valid contact email', () => {
  const pickup = makeCheckout('pickup');
  assert.equal(checkoutSchema.safeParse({
    ...pickup,
    contact: { ...pickup.contact, firstName: '' },
  }).success, false);
  assert.equal(checkoutSchema.safeParse({
    ...pickup,
    contact: { ...pickup.contact, email: 'not-an-email' },
  }).success, false);
});

test('saved account postal codes are empty or exactly four digits', () => {
  const user = new User({
    username: 'Customer_01',
    email: 'contactuser@gmail.com',
    passwordHash: 'hash',
    postalCode: '12345',
  });

  assert.match(user.validateSync().errors.postalCode.message, /exactly 4 digits/);
  user.postalCode = '1000';
  assert.equal(user.validateSync(), undefined);
});
