const assert = require('node:assert/strict');
const { test } = require('node:test');

const db = require('../src/config/db');
const userRepository = require('../src/repositories/userRepository');
const orderRepository = require('../src/repositories/orderRepository');
const {
  getDashboardStats,
  getStartOfDayInTimeZone,
} = require('../src/services/stats.service');

test('dashboard stats aggregate order counts, revenue, sales timeframes, and top items', async (context) => {
  const queries = [];

  // stats.service destructures `query` at import time, so we must mock at the
  // pool level — the exported `query` helper always delegates to pool.query.
  const pool = db.getPool();
  context.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params });

    // Order counts / totals (countsSql)
    if (/total_orders/.test(sql)) {
      return {
        rows: [
          {
            total_orders: 12,
            pending_orders: 2,
            to_pickup_orders: 1,
            to_ship_orders: 0,
            completed_orders: 8,
            cancelled_orders: 1,
            total_revenue: '2400',
          },
        ],
      };
    }

    // getCompletedSalesSince (called 3 times – daily / weekly / monthly)
    if (/COUNT\(\*\)::int as count/.test(sql) && /updated_at/.test(sql)) {
      const startDate = params[0];
      const now = new Date();
      const diffDays = (now - startDate) / (24 * 60 * 60 * 1000);
      if (diffDays < 2) return { rows: [{ count: 2, revenue: '540' }] };
      if (diffDays < 10) return { rows: [{ count: 5, revenue: '1275' }] };
      return { rows: [{ count: 9, revenue: '2400' }] };
    }

    // revenueHistorySql
    if (/TO_CHAR/.test(sql)) {
      return {
        rows: [{ date_str: '2026-10-07', revenue: '540', orders: 2 }],
      };
    }

    // topItemsSql
    if (/order_items/.test(sql)) {
      return {
        rows: [{ _id: 'Classic Burger', total_qty: 4, total_sales: '720' }],
      };
    }

    throw new Error(`Unexpected SQL: ${sql.trim().slice(0, 60)}`);
  });

  // userRepository.count for totalCustomers
  context.mock.method(userRepository, 'count', async () => 6);

  // orderRepository.find for recentOrders
  context.mock.method(orderRepository, 'find', async () => []);

  const stats = await getDashboardStats();

  assert.equal(stats.totalRevenue, 2400);
  assert.equal(stats.totalOrders, 12);
  assert.equal(stats.totalCustomers, 6);
  assert.deepEqual(stats.sales, {
    daily: { count: 2, revenue: 540 },
    weekly: { count: 5, revenue: 1275 },
    monthly: { count: 9, revenue: 2400 },
  });
  assert.deepEqual(stats.revenueHistory, [
    { _id: '2026-10-07', revenue: 540, orders: 2 },
  ]);
  assert.deepEqual(stats.topItems, [
    { _id: 'Classic Burger', totalQty: 4, totalSales: 720 },
  ]);

  // All three getCompletedSalesSince calls must pass a Date as $1
  const salesQueries = queries.filter(
    ({ sql }) => /COUNT\(\*\)::int as count/.test(sql) && /updated_at/.test(sql)
  );
  assert.equal(salesQueries.length, 3);
  for (const { params } of salesQueries) {
    assert.ok(params[0] instanceof Date, 'startDate must be a Date');
  }

  // Daily sales boundary must be the start of today in Asia/Manila
  const today = new Date();
  const expectedToday = getStartOfDayInTimeZone(today, 'Asia/Manila');
  assert.equal(salesQueries[0].params[0].getTime(), expectedToday.getTime());

  // Revenue history must look back exactly 29 days from the start of today
  const revQuery = queries.find(({ sql }) => /TO_CHAR/.test(sql));
  assert.ok(revQuery, 'revenue history query not found');
  const revStart = revQuery.params[0];
  assert.ok(revStart instanceof Date);
  assert.equal(
    revStart.getTime(),
    expectedToday.getTime() - 29 * 24 * 60 * 60 * 1000
  );
});

test('store-day boundary honors the Asia/Manila UTC+8 offset', () => {
  const date = new Date('2026-10-07T05:14:32.876Z');
  assert.equal(
    getStartOfDayInTimeZone(date, 'Asia/Manila').toISOString(),
    '2026-10-06T16:00:00.000Z'
  );
});
