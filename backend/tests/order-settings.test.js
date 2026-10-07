const assert = require('node:assert/strict');
const { test } = require('node:test');

const Settings = require('../src/models/Settings');
let placeOrder;

test('order placement is blocked when the admin pauses online ordering', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  ({ placeOrder } = require('../src/services/order.service'));
  context.mock.method(Settings, 'findOne', async () => ({ acceptingOrders: false }));

  await assert.rejects(
    placeOrder({ userId: 'user-id', cartItemIds: ['cart-item'], fulfillment: 'pickup', paymentMethod: 'gcash' }),
    (error) => error.statusCode === 400 && /not accepting new orders/.test(error.message)
  );
});

test('order placement respects disabled fulfillment and payment options', async (context) => {
  context.mock.method(Settings, 'findOne', async () => ({
    acceptingOrders: true,
    deliveryEnabled: false,
    pickupEnabled: false,
    gcashEnabled: false,
    codEnabled: false,
    payAtShopEnabled: false,
  }));

  await assert.rejects(
    placeOrder({ userId: 'user-id', cartItemIds: ['cart-item'], fulfillment: 'delivery', paymentMethod: 'gcash' }),
    (error) => error.statusCode === 400 && /Delivery service is currently unavailable/.test(error.message)
  );
  await assert.rejects(
    placeOrder({ userId: 'user-id', cartItemIds: ['cart-item'], fulfillment: 'pickup', paymentMethod: 'gcash' }),
    (error) => error.statusCode === 400 && /Store pickup is currently unavailable/.test(error.message)
  );
});

test('order placement blocks payment methods disabled for the selected fulfillment', async (context) => {
  context.mock.method(Settings, 'findOne', async () => ({
    acceptingOrders: true,
    deliveryEnabled: true,
    pickupEnabled: true,
    gcashEnabled: false,
    codEnabled: false,
    payAtShopEnabled: false,
  }));

  await assert.rejects(
    placeOrder({ userId: 'user-id', cartItemIds: ['cart-item'], fulfillment: 'delivery', paymentMethod: 'cod' }),
    (error) => error.statusCode === 400 && /Cash on delivery is currently disabled/.test(error.message)
  );
  await assert.rejects(
    placeOrder({ userId: 'user-id', cartItemIds: ['cart-item'], fulfillment: 'pickup', paymentMethod: 'pay_at_shop' }),
    (error) => error.statusCode === 400 && /Pay at shop is currently disabled/.test(error.message)
  );
});
