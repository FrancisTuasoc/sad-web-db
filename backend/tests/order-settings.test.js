const assert = require('node:assert/strict');
const { test } = require('node:test');

const mongoose = require('mongoose');
const Settings = require('../src/models/Settings');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
let placeOrder;
let updateOrderStatus;
let expirePayAtShopOrders;

test('order placement is blocked when the admin pauses online ordering', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  ({ placeOrder, updateOrderStatus, expirePayAtShopOrders } = require('../src/services/order.service'));
  context.mock.method(Settings, 'findOne', async () => ({ acceptingOrders: false }));

  await assert.rejects(
    placeOrder({ userId: 'user-id', cartItemIds: ['cart-item'], fulfillment: 'pickup', paymentMethod: 'gcash' }),
    (error) => error.statusCode === 400 && /not accepting new orders/.test(error.message)
  );
});

test('pay-at-shop orders move through preparing before ready for pickup', async (context) => {
  let status = 'pending';
  context.mock.method(Order, 'findById', async () => ({
    status,
    fulfillment: 'pickup',
    paymentMethod: 'pay_at_shop',
  }));
  context.mock.method(Order, 'findOneAndUpdate', async (query, update) => {
    assert.equal(query.status, status);
    status = update.$set.status;
    return { status };
  });

  const preparingOrder = await updateOrderStatus('order-id', 'preparing');
  assert.equal(preparingOrder.status, 'preparing');

  const readyOrder = await updateOrderStatus('order-id', 'ready_for_pickup');
  assert.equal(readyOrder.status, 'ready_for_pickup');

  await assert.rejects(
    updateOrderStatus('order-id', 'preparing'),
    (error) => error.statusCode === 409
  );
});

test('expired pay-at-shop orders are cancelled and their reserved stock is restored', async (context) => {
  const now = new Date('2026-10-07T14:00:00.000Z');
  const order = {
    _id: 'order-id',
    status: 'pending',
    paymentMethod: 'pay_at_shop',
    arrivalDeadline: new Date(now.getTime() - 1),
    items: [{ product: 'product-id', quantity: 2, addons: [] }],
  };
  let restoredQuantity = 0;
  const session = {
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  };

  context.mock.method(mongoose, 'startSession', async () => session);
  context.mock.method(Order, 'find', () => ({
    select() { return this; },
    sort() { return this; },
    limit: async () => [order],
  }));
  context.mock.method(Order, 'findOne', () => ({
    session: async () => order,
  }));
  context.mock.method(Order, 'findOneAndUpdate', async (query, update) => {
    assert.equal(query.paymentMethod, 'pay_at_shop');
    assert.deepEqual(query.arrivalDeadline, { $lte: now });
    assert.equal(update.$set.cancelledBy, 'system');
    order.status = update.$set.status;
    return order;
  });
  context.mock.method(Product, 'findByIdAndUpdate', async (productId, update) => {
    restoredQuantity += update.$inc.stock;
    return { _id: productId, stock: 10, isAvailable: true };
  });

  assert.equal(await expirePayAtShopOrders(now), 1);
  assert.equal(order.status, 'cancelled');
  assert.equal(restoredQuantity, 2);
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
