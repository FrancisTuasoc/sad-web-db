const assert = require('node:assert/strict');
const { test } = require('node:test');
const database = require('../src/config/db');

const originalGetClient = database.getClient;
const queries = [];
database.getClient = async () => ({
  async query(sql, params = []) {
    queries.push({ sql, params });
    if (/INSERT INTO orders/.test(sql)) {
      return { rows: [{ id: 'test-order-id' }] };
    }
    return { rows: [] };
  },
  release() {},
});

const orderRepository = require('../src/repositories/orderRepository');

test('create persists the supplied GCash reference', async (context) => {
  const originalFindById = orderRepository.findById;
  orderRepository.findById = async (id) => ({ id });
  context.after(() => {
    orderRepository.findById = originalFindById;
    database.getClient = originalGetClient;
  });

  const order = await orderRepository.create({
    orderNumber: 'BRG-20261012-1234',
    userId: 'test-user-id',
    subtotal: 52,
    total: 52,
    fulfillment: 'pickup',
    paymentMethod: 'gcash',
    paymentStatus: 'unpaid',
    gcashReference: '0000000000000',
    contact: {
      fullName: 'Test Customer',
      firstName: 'Test',
      lastName: 'Customer',
      email: 'test@example.com',
      phone: '09171234567',
    },
  });

  const insert = queries.find(({ sql }) => /INSERT INTO orders/.test(sql));
  assert.ok(insert);
  assert.equal(insert.params[9], '0000000000000');
  assert.deepEqual(order, { id: 'test-order-id' });
  assert.ok(queries.some(({ sql }) => sql === 'COMMIT'));
});
