const assert = require('node:assert/strict');
const { test } = require('node:test');
const checkoutSchema = require('../src/utils/checkoutValidation');

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

  assert.equal(
    checkoutSchema.safeParse({
      ...validDelivery,
      contact: { ...validDelivery.contact, postalCode: '10000' },
    }).success,
    false
  );
  assert.equal(
    checkoutSchema.safeParse({
      ...validDelivery,
      contact: { ...validDelivery.contact, barangay: '' },
    }).success,
    false
  );
});

test('checkout requires first and last name and a valid contact email', () => {
  const pickup = makeCheckout('pickup');
  assert.equal(
    checkoutSchema.safeParse({
      ...pickup,
      contact: { ...pickup.contact, firstName: '' },
    }).success,
    false
  );
  assert.equal(
    checkoutSchema.safeParse({
      ...pickup,
      contact: { ...pickup.contact, email: 'not-an-email' },
    }).success,
    false
  );
});

test('postal code must be empty or exactly four digits', () => {
  // Five-digit postal code is rejected
  const result = checkoutSchema.safeParse(
    makeCheckout('pickup', { postalCode: '12345' })
  );
  assert.equal(result.success, false);

  // Four-digit postal code is accepted
  assert.equal(
    checkoutSchema.safeParse(makeCheckout('pickup', { postalCode: '1000' }))
      .success,
    true
  );

  // Empty postal code is accepted for pickup
  assert.equal(
    checkoutSchema.safeParse(makeCheckout('pickup', { postalCode: '' }))
      .success,
    true
  );
});
