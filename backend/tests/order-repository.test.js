const assert = require('node:assert/strict');
const { test } = require('node:test');
const database = require('../src/config/db');

const originalGetClient = database.getClient;
const originalQuery = database.query;
const queries = [];
database.query = async (sql, params = []) => {
  queries.push({ sql, params });
  return { rows: [{ count: 5 }] };
};
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
    database.query = originalQuery;
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

test('count applies order search and admin filters', async (context) => {
  context.after(() => {
    database.getClient = originalGetClient;
    database.query = originalQuery;
  });

  const count = await orderRepository.count({
    search: ' Kenshin ',
    status: 'completed',
    paymentStatus: 'paid',
    fulfillment: 'pickup',
    dateRange: 'week',
  });
  const countQuery = queries.at(-1);

  assert.equal(count, 5);
  assert.match(countQuery.sql, /o\.status = \$\d+/);
  assert.match(countQuery.sql, /o\.payment_status = \$\d+/);
  assert.match(countQuery.sql, /o\.fulfillment = \$\d+/);
  assert.match(countQuery.sql, /o\.order_number ILIKE \$\d+/);
  assert.match(countQuery.sql, /o\.created_at >= NOW\(\) - INTERVAL '7 days'/);
  assert.deepEqual(countQuery.params, [
    'completed',
    'paid',
    'pickup',
    '%Kenshin%',
  ]);
});
