const express = require('express');
const { z } = require('zod');
const { query } = require('../config/db');
const userRepository = require('../repositories/userRepository');
const orderRepository = require('../repositories/orderRepository');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => {
  if (req.user.role !== 'customer') {
    return next(new AppError('Customer access required.', 403));
  }
  next();
});

const statusValues = [
  'pending',
  'preparing',
  'ready_for_pickup',
  'ready_to_deliver',
  'completed',
  'cancelled',
  'to_pickup',
  'to_ship',
];
const queryStatusSchema = z.enum(['all', 'active', 'history', ...statusValues]);
const customerOrdersQuerySchema = z
  .object({
    status: queryStatusSchema.optional().default('all'),
    page: z
      .string()
      .optional()
      .default('1')
      .transform((value) => Number(value))
      .refine(
        (value) => Number.isInteger(value) && value > 0,
        'Page must be a positive integer'
      ),
    limit: z
      .string()
      .optional()
      .default('10')
      .transform((value) => Number(value))
      .refine(
        (value) => Number.isInteger(value) && value > 0 && value <= 20,
        'Limit must be between 1 and 20'
      ),
  })
  .strict();

const usernameSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters long')
      .max(20, 'Username cannot exceed 20 characters')
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_]*$/,
        'Username must start with a letter and can only contain letters, numbers, and underscores'
      ),
  })
  .strict();

const usernameRateMap = new Map();
function enforceUsernameRateLimit(req, res, next) {
  const key = req.user ? req.user.id : req.ip;
  const now = Date.now();
  let record = usernameRateMap.get(key);

  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + 60_000 };
    usernameRateMap.set(key, record);
  }

  record.count += 1;
  if (record.count > 3) {
    const seconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return next(
      new AppError(
        `Too many username updates. Please try again in ${seconds} second(s).`,
        429
      )
    );
  }

  next();
}

function getStatusFilter(status) {
  if (!status || status === 'all') return null;
  if (status === 'active') {
    return [
      'pending',
      'preparing',
      'ready_for_pickup',
      'ready_to_deliver',
      'to_pickup',
      'to_ship',
    ];
  }
  if (status === 'history') {
    return ['completed', 'cancelled'];
  }
  return status;
}

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = await userRepository.findById(req.user.id);
    if (!user) {
      throw new AppError('Account not found.', 404);
    }

    res.json({
      success: true,
      user: userRepository.safeUser(user),
    });
  })
);

router.patch(
  '/me/username',
  enforceUsernameRateLimit,
  validate(usernameSchema),
  asyncHandler(async (req, res) => {
    const { username } = req.body;
    const existing = await userRepository.findByUsername(username);

    if (existing && existing.id !== req.user.id) {
      throw new AppError(
        'This username is already taken. Please choose another one.',
        409
      );
    }

    const updated = await userRepository.update(req.user.id, { username });

    res.json({
      success: true,
      message: 'Username updated successfully.',
      user: userRepository.safeUser(updated),
    });
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const customerId = req.user.id;

    const summarySql = `
      SELECT 
        COUNT(*)::int as total_orders,
        COUNT(*) FILTER (WHERE status = 'pending')::int as pending_orders,
        COUNT(*) FILTER (WHERE status IN ('pending', 'preparing', 'ready_for_pickup', 'ready_to_deliver', 'to_pickup', 'to_ship'))::int as active_orders,
        COUNT(*) FILTER (WHERE status = 'completed')::int as completed_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int as cancelled_orders,
        COALESCE(SUM(total) FILTER (WHERE status = 'completed'), 0)::numeric as total_spent,
        COALESCE(AVG(total), 0)::numeric as avg_order_value,
        MAX(created_at) as last_order_date
      FROM orders
      WHERE user_id = $1
    `;
    const summaryRes = await query(summarySql, [customerId]);
    const summary = summaryRes.rows[0];

    const favSql = `
      SELECT 
        oi.name as _id,
        SUM(oi.quantity)::int as quantity
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.user_id = $1 AND o.status != 'cancelled'
      GROUP BY oi.name
      ORDER BY quantity DESC, oi.name ASC
      LIMIT 1
    `;
    const favRes = await query(favSql, [customerId]);
    const favoriteItem = favRes.rows[0];

    const statusCountsSql = `
      SELECT status, COUNT(*)::int as count
      FROM orders
      WHERE user_id = $1
      GROUP BY status
    `;
    const scRes = await query(statusCountsSql, [customerId]);
    const countsMap = new Map(scRes.rows.map((r) => [r.status, r.count]));

    const statusCounts = {};
    for (const s of statusValues) {
      statusCounts[s] = countsMap.get(s) || 0;
    }

    const totalCompleted = Number(summary?.completed_orders || 0);
    const totalSpent = Number(summary?.total_spent || 0);
    const avgOrderValue = totalCompleted > 0 ? totalSpent / totalCompleted : 0;

    res.json({
      success: true,
      stats: {
        totalOrders: Number(summary?.total_orders || 0),
        activeOrders: Number(summary?.active_orders || 0),
        pendingOrders: Number(summary?.pending_orders || 0),
        completedOrders: totalCompleted,
        cancelledOrders: Number(summary?.cancelled_orders || 0),
        totalSpent,
        averageOrderValue: avgOrderValue,
        lastOrderDate: summary?.last_order_date || null,
        favoriteItem: favoriteItem
          ? { name: favoriteItem._id, quantity: favoriteItem.quantity }
          : null,
        statusCounts,
      },
    });
  })
);

router.get(
  '/kpis',
  asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const summarySql = `
    SELECT 
      COUNT(*)::int as total_orders,
      COUNT(*) FILTER (WHERE status = 'pending')::int as pending_orders,
      COUNT(*) FILTER (WHERE status = 'completed')::int as delivered_orders,
      COALESCE(SUM(total) FILTER (WHERE status = 'completed'), 0)::numeric as total_spent
    FROM orders
    WHERE user_id = $1
  `;
    const summaryRes = await query(summarySql, [userId]);
    const summary = summaryRes.rows[0];

    const statusCountsSql = `
    SELECT status, COUNT(*)::int as count
    FROM orders
    WHERE user_id = $1
    GROUP BY status
  `;
    const scRes = await query(statusCountsSql, [userId]);
    const countsMap = new Map(scRes.rows.map((r) => [r.status, r.count]));
    const statusCounts = {};
    for (const s of statusValues) {
      statusCounts[s] = countsMap.get(s) || 0;
    }

    const recentOrders = await orderRepository.find({ userId }, { limit: 5 });

    res.json({
      success: true,
      kpis: {
        totalOrders: Number(summary?.total_orders || 0),
        pendingOrders: Number(summary?.pending_orders || 0),
        deliveredOrders: Number(summary?.delivered_orders || 0),
        totalSpent: Number(summary?.total_spent || 0),
        statusCounts,
        recentOrders: recentOrders.map((order) => ({
          _id: order.id,
          id: order.id,
          orderNumber: order.orderNumber,
          total: Number(order.total || 0),
          status: order.status,
          createdAt: order.createdAt,
        })),
      },
    });
  })
);

router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const parsed = customerOrdersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(issue ? issue.message : 'Invalid order query', 400);
    }

    const { status, page, limit } = parsed.data;
    const filter = { userId: req.user.id };
    const statusVal = getStatusFilter(status);
    if (statusVal) filter.status = statusVal;

    const total = await orderRepository.count(filter);
    const orders = await orderRepository.find(filter, {
      limit,
      offset: (page - 1) * limit,
    });

    res.json({
      success: true,
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  })
);

module.exports = router;
