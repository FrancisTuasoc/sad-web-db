const Order = require('../models/Order');
const User = require('../models/User');
const STORE_TIME_ZONE = 'Asia/Manila';

const completedAtExpression = {
  $ifNull: [
    {
      $arrayElemAt: [
        {
          $map: {
            input: {
              $filter: {
                input: { $ifNull: ['$statusHistory', []] },
                as: 'entry',
                cond: { $eq: ['$$entry.status', 'completed'] },
              },
            },
            as: 'completion',
            in: '$$completion.at',
          },
        },
        -1,
      ],
    },
    '$createdAt',
  ],
};

function getCompletedSalesSince(startDate) {
  return Order.aggregate([
    { $match: { status: 'completed' } },
    { $set: { completedAt: completedAtExpression } },
    { $match: { completedAt: { $gte: startDate } } },
    { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$total' } } },
  ]);
}

function getStartOfDayInTimeZone(date, timeZone) {
  const dateTimeParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date).reduce((parts, part) => {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
    return parts;
  }, {});

  const localTimeAsUtc = Date.UTC(
    dateTimeParts.year,
    dateTimeParts.month - 1,
    dateTimeParts.day,
    dateTimeParts.hour,
    dateTimeParts.minute,
    dateTimeParts.second
  );
  const offset = localTimeAsUtc - Math.floor(date.getTime() / 1000) * 1000;
  return new Date(Date.UTC(dateTimeParts.year, dateTimeParts.month - 1, dateTimeParts.day) - offset);
}

async function getDashboardStats() {
  const [orderCounts] = await Order.aggregate([
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        pendingOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] },
        },
        toPickupOrders: {
          $sum: { $cond: [{ $in: ['$status', ['ready_for_pickup', 'to_pickup']] }, 1, 0] },
        },
        toShipOrders: {
          $sum: { $cond: [{ $in: ['$status', ['ready_to_deliver', 'to_ship']] }, 1, 0] },
        },
        completedOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
        },
        cancelledOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] },
        },
        totalRevenue: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$total', 0] },
        },
      },
    },
  ]);

  const totalCustomers = await User.countDocuments({ role: 'customer' });

  const stats = {
    totalOrders: orderCounts ? orderCounts.totalOrders : 0,
    pendingOrders: orderCounts ? orderCounts.pendingOrders : 0,
    toPickupOrders: orderCounts ? orderCounts.toPickupOrders : 0,
    toShipOrders: orderCounts ? orderCounts.toShipOrders : 0,
    completedOrders: orderCounts ? orderCounts.completedOrders : 0,
    cancelledOrders: orderCounts ? orderCounts.cancelledOrders : 0,
    totalRevenue: orderCounts ? orderCounts.totalRevenue : 0,
    totalCustomers,
  };

  // Sales timeframes (completed orders)
  const now = new Date();
  const startOfDay = getStartOfDayInTimeZone(now, STORE_TIME_ZONE);
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [[dailySales], [weeklySales], [monthlySales]] = await Promise.all([
    getCompletedSalesSince(startOfDay),
    getCompletedSalesSince(startOfWeek),
    getCompletedSalesSince(startOfMonth),
  ]);

  stats.sales = {
    daily: {
      count: dailySales ? dailySales.count : 0,
      revenue: dailySales ? dailySales.revenue : 0,
    },
    weekly: {
      count: weeklySales ? weeklySales.count : 0,
      revenue: weeklySales ? weeklySales.revenue : 0,
    },
    monthly: {
      count: monthlySales ? monthlySales.count : 0,
      revenue: monthlySales ? monthlySales.revenue : 0,
    },
  };

  // Revenue by date for the last 30 days
  const thirtyDaysAgo = new Date(startOfDay.getTime() - 29 * 24 * 60 * 60 * 1000);
  const revenueHistory = await Order.aggregate([
    { $match: { status: 'completed' } },
    { $set: { completedAt: completedAtExpression } },
    { $match: { completedAt: { $gte: thirtyDaysAgo } } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$completedAt', timezone: STORE_TIME_ZONE },
        },
        revenue: { $sum: '$total' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  stats.revenueHistory = revenueHistory;

  // Completed vs Cancelled comparison
  stats.statusComparison = {
    completed: stats.completedOrders,
    cancelled: stats.cancelledOrders,
    pending: stats.pendingOrders,
    inProgress: (stats.toPickupOrders || 0) + (stats.toShipOrders || 0),
  };

  // Top 5 most ordered items
  const topItems = await Order.aggregate([
    { $match: { status: { $ne: 'cancelled' } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.name',
        totalQty: { $sum: '$items.quantity' },
        totalSales: { $sum: '$items.lineTotal' },
      },
    },
    { $sort: { totalQty: -1 } },
    { $limit: 5 },
  ]);
  stats.topItems = topItems;

  // Recent 8 orders
  const recentOrders = await Order.find()
    .sort({ createdAt: -1 })
    .limit(8)
    .select('orderNumber contact total fulfillment paymentMethod status paymentStatus createdAt');

  stats.recentOrders = recentOrders;

  return stats;
}

module.exports = {
  getDashboardStats,
  getStartOfDayInTimeZone,
};
