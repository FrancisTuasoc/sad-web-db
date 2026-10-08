const { query } = require('../config/db');
const orderRepository = require('../repositories/orderRepository');
const userRepository = require('../repositories/userRepository');

const STORE_TIME_ZONE = 'Asia/Manila';

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
  })
    .formatToParts(date)
    .reduce((parts, part) => {
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
  return new Date(
    Date.UTC(dateTimeParts.year, dateTimeParts.month - 1, dateTimeParts.day) -
      offset
  );
}

async function getCompletedSalesSince(startDate) {
  const sql = `
    SELECT 
      COUNT(*)::int as count,
      COALESCE(SUM(total), 0)::numeric as revenue
    FROM orders
    WHERE status = 'completed' AND updated_at >= $1
  `;
  const res = await query(sql, [startDate]);
  return {
    count: res.rows[0].count,
    revenue: Number(res.rows[0].revenue),
  };
}

async function getDashboardStats() {
  const countsSql = `
    SELECT 
      COUNT(*)::int as total_orders,
      COUNT(*) FILTER (WHERE status = 'pending')::int as pending_orders,
      COUNT(*) FILTER (WHERE status IN ('preparing', 'ready_for_pickup', 'to_pickup'))::int as to_pickup_orders,
      COUNT(*) FILTER (WHERE status IN ('ready_to_deliver', 'to_ship'))::int as to_ship_orders,
      COUNT(*) FILTER (WHERE status = 'completed')::int as completed_orders,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int as cancelled_orders,
      COALESCE(SUM(total) FILTER (WHERE status = 'completed'), 0)::numeric as total_revenue
    FROM orders
  `;
  const countsRes = await query(countsSql);
  const orderCounts = countsRes.rows[0];

  const totalCustomers = await userRepository.count({ role: 'customer' });

  const stats = {
    totalOrders: orderCounts.total_orders || 0,
    pendingOrders: orderCounts.pending_orders || 0,
    toPickupOrders: orderCounts.to_pickup_orders || 0,
    toShipOrders: orderCounts.to_ship_orders || 0,
    completedOrders: orderCounts.completed_orders || 0,
    cancelledOrders: orderCounts.cancelled_orders || 0,
    totalRevenue: Number(orderCounts.total_revenue || 0),
    totalCustomers,
  };

  // Sales timeframes
  const now = new Date();
  const startOfDay = getStartOfDayInTimeZone(now, STORE_TIME_ZONE);
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [dailySales, weeklySales, monthlySales] = await Promise.all([
    getCompletedSalesSince(startOfDay),
    getCompletedSalesSince(startOfWeek),
    getCompletedSalesSince(startOfMonth),
  ]);

  stats.sales = {
    daily: dailySales,
    weekly: weeklySales,
    monthly: monthlySales,
  };

  // Revenue by date for the last 30 days
  const thirtyDaysAgo = new Date(
    startOfDay.getTime() - 29 * 24 * 60 * 60 * 1000
  );
  const revenueHistorySql = `
    SELECT 
      TO_CHAR(updated_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') as date_str,
      COALESCE(SUM(total), 0)::numeric as revenue,
      COUNT(*)::int as orders
    FROM orders
    WHERE status = 'completed' AND updated_at >= $1
    GROUP BY date_str
    ORDER BY date_str ASC
  `;
  const revRes = await query(revenueHistorySql, [thirtyDaysAgo]);
  stats.revenueHistory = revRes.rows.map((row) => ({
    _id: row.date_str,
    revenue: Number(row.revenue),
    orders: row.orders,
  }));

  // Completed vs Cancelled comparison
  stats.statusComparison = {
    completed: stats.completedOrders,
    cancelled: stats.cancelledOrders,
    pending: stats.pendingOrders,
    inProgress: (stats.toPickupOrders || 0) + (stats.toShipOrders || 0),
  };

  // Top 5 most ordered items
  const topItemsSql = `
    SELECT 
      oi.name as _id,
      SUM(oi.quantity)::int as total_qty,
      SUM(oi.line_total)::numeric as total_sales
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status != 'cancelled'
    GROUP BY oi.name
    ORDER BY total_qty DESC
    LIMIT 5
  `;
  const topRes = await query(topItemsSql);
  stats.topItems = topRes.rows.map((r) => ({
    _id: r._id,
    totalQty: r.total_qty,
    totalSales: Number(r.total_sales),
  }));

  // Recent 8 orders
  const recentOrders = await orderRepository.find({}, { limit: 8 });
  stats.recentOrders = recentOrders;

  return stats;
}

module.exports = {
  getDashboardStats,
  getStartOfDayInTimeZone,
};
