const assert = require('node:assert/strict');
const { test } = require('node:test');

const Order = require('../src/models/Order');
const User = require('../src/models/User');
const { getDashboardStats, getStartOfDayInTimeZone } = require('../src/services/stats.service');

test('dashboard sales use the store day and report completed-order revenue by completion time', async (context) => {
  const pipelines = [];
  const expectedSales = [
    { count: 2, revenue: 540 },
    { count: 5, revenue: 1275 },
    { count: 9, revenue: 2400 },
  ];
  let salesCall = 0;

  context.mock.method(Order, 'aggregate', async (pipeline) => {
    pipelines.push(pipeline);

    if (pipeline.some((stage) => stage.$unwind === '$items')) {
      return [{ _id: 'Classic Burger', totalQty: 4, totalSales: 720 }];
    }
    if (pipeline.some((stage) => stage.$group && stage.$group.totalOrders)) {
      return [{
        totalOrders: 12,
        pendingOrders: 2,
        toPickupOrders: 1,
        toShipOrders: 0,
        completedOrders: 8,
        cancelledOrders: 1,
        totalRevenue: 2400,
      }];
    }
    if (pipeline.some((stage) => stage.$group && stage.$group._id && stage.$group._id.$dateToString)) {
      return [{ _id: '2026-10-07', revenue: 540, orders: 2 }];
    }
    if (pipeline.some((stage) => stage.$group && stage.$group.count)) {
      const sales = expectedSales[salesCall];
      salesCall += 1;
      return [sales];
    }
    throw new Error('Unexpected dashboard aggregation pipeline');
  });
  context.mock.method(User, 'countDocuments', async () => 6);
  context.mock.method(Order, 'find', () => ({
    sort() { return this; },
    limit() { return this; },
    select: async () => [],
  }));

  const stats = await getDashboardStats();

  assert.equal(stats.totalRevenue, 2400);
  assert.equal(stats.totalOrders, 12);
  assert.equal(stats.totalCustomers, 6);
  assert.deepEqual(stats.sales, {
    daily: { count: 2, revenue: 540 },
    weekly: { count: 5, revenue: 1275 },
    monthly: { count: 9, revenue: 2400 },
  });
  assert.deepEqual(stats.revenueHistory, [{ _id: '2026-10-07', revenue: 540, orders: 2 }]);

  const timeBoundSales = pipelines.filter((pipeline) => (
    pipeline.some((stage) => stage.$match && stage.$match.completedAt)
  ));
  assert.equal(timeBoundSales.length, 4);
  for (const pipeline of timeBoundSales) {
    assert.equal(pipeline[0].$match.status, 'completed');
    assert.ok(pipeline.some((stage) => stage.$set && stage.$set.completedAt));
    assert.ok(pipeline.some((stage) => (
      stage.$match && stage.$match.completedAt && stage.$match.completedAt.$gte instanceof Date
    )));
  }
  const today = new Date();
  const expectedToday = getStartOfDayInTimeZone(today, 'Asia/Manila');
  assert.equal(timeBoundSales[0][2].$match.completedAt.$gte.getTime(), expectedToday.getTime());
  const historyPipeline = pipelines.find((pipeline) => (
    pipeline.some((stage) => stage.$group && stage.$group._id && stage.$group._id.$dateToString)
  ));
  const dateGroup = historyPipeline.find((stage) => stage.$group && stage.$group._id);
  assert.equal(dateGroup.$group._id.$dateToString.timezone, 'Asia/Manila');
  assert.equal(
    historyPipeline.find((stage) => stage.$match && stage.$match.completedAt).$match.completedAt.$gte.getTime(),
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
