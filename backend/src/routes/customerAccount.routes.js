const express = require('express');
const { z } = require('zod');

const User = require('../models/User');
const Order = require('../models/Order');
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

const statusValues = ['pending', 'ready_for_pickup', 'ready_to_deliver', 'completed', 'cancelled', 'to_pickup', 'to_ship'];
const queryStatusSchema = z.enum(['all', 'active', 'history', ...statusValues]);
const customerOrdersQuerySchema = z
  .object({
    status: queryStatusSchema.optional().default('all'),
    page: z
      .string()
      .optional()
      .default('1')
      .transform((value) => Number(value))
      .refine((value) => Number.isInteger(value) && value > 0, 'Page must be a positive integer'),
    limit: z
      .string()
      .optional()
      .default('10')
      .transform((value) => Number(value))
      .refine((value) => Number.isInteger(value) && value > 0 && value <= 20, 'Limit must be between 1 and 20'),
  })
  .strict();

const usernameSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters long')
      .max(20, 'Username cannot exceed 20 characters')
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Username must start with a letter and can only contain letters, numbers, and underscores'),
  })
  .strict();

const usernameRateMap = new Map();
function enforceUsernameRateLimit(req, res, next) {
  const key = req.user ? req.user._id.toString() : req.ip;
  const now = Date.now();
  let record = usernameRateMap.get(key);

  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + 60_000 };
    usernameRateMap.set(key, record);
  }

  record.count += 1;
  if (record.count > 3) {
    const seconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return next(new AppError(`Too many username updates. Please try again in ${seconds} second(s).`, 429));
  }

  next();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getStatusFilter(status) {
  if (!status || status === 'all') return {};
  if (status === 'active') {
    return { status: { $in: ['pending', 'ready_for_pickup', 'ready_to_deliver', 'to_pickup', 'to_ship'] } };
  }
  if (status === 'history') {
    return { status: { $in: ['completed', 'cancelled'] } };
  }
  return { status };
}

function serializeUser(user) {
  if (!user) return null;
  const plain = user.toObject ? user.toObject() : { ...user };
  delete plain.passwordHash;
  delete plain.__v;
  return plain;
}

router.get('/me', asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).lean();
  if (!user) {
    throw new AppError('Account not found.', 404);
  }

  const { passwordHash, __v, ...safeUser } = user;
  res.json({
    success: true,
    user: safeUser,
  });
}));

router.patch(
  '/me/username',
  enforceUsernameRateLimit,
  validate(usernameSchema),
  asyncHandler(async (req, res) => {
    const { username } = req.body;
    const user = await User.findById(req.user._id);

    const existing = await User.findOne({
      username: { $regex: `^${escapeRegex(username)}$`, $options: 'i' },
      _id: { $ne: req.user._id },
    });

    if (existing) {
      throw new AppError('This username is already taken. Please choose another one.', 409);
    }

    user.username = username;
    await user.save();

    res.json({
      success: true,
      message: 'Username updated successfully.',
      user: serializeUser(user),
    });
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const customerId = req.user._id;

    const [summary] = await Order.aggregate([
      { $match: { user: customerId } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          pendingOrders: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          activeOrders: {
            $sum: {
              $cond: [{ $in: ['$status', ['pending', 'ready_for_pickup', 'ready_to_deliver', 'to_pickup', 'to_ship']] }, 1, 0],
            },
          },
          completedOrders: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          cancelledOrders: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          totalSpent: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$total', 0] } },
          avgOrderValue: { $avg: '$total' },
          lastOrderDate: { $max: '$createdAt' },
        },
      },
    ]);

    const [favoriteItem] = await Order.aggregate([
      { $match: { user: customerId, status: { $ne: 'cancelled' } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          quantity: { $sum: '$items.quantity' },
        },
      },
      { $sort: { quantity: -1, _id: 1 } },
      { $limit: 1 },
    ]);

    const statusCounts = {};
    for (const status of statusValues) {
      statusCounts[status] = await Order.countDocuments({ user: customerId, status });
    }

    const stats = summary || {
      totalOrders: 0,
      pendingOrders: 0,
      activeOrders: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      totalSpent: 0,
      avgOrderValue: 0,
      lastOrderDate: null,
    };

    const totalCompleted = Number(stats.completedOrders || 0);
    const totalSpent = Number(stats.totalSpent || 0);
    const avgOrderValue = totalCompleted > 0 ? totalSpent / totalCompleted : 0;

    res.json({
      success: true,
      stats: {
        totalOrders: Number(stats.totalOrders || 0),
        activeOrders: Number(stats.activeOrders || 0),
        pendingOrders: Number(stats.pendingOrders || 0),
        completedOrders: totalCompleted,
        cancelledOrders: Number(stats.cancelledOrders || 0),
        totalSpent,
        averageOrderValue: avgOrderValue,
        lastOrderDate: stats.lastOrderDate || null,
        favoriteItem: favoriteItem ? { name: favoriteItem._id, quantity: favoriteItem.quantity } : null,
        statusCounts,
      },
    });
  })
);

router.get('/kpis', asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const [summary] = await Order.aggregate([
    { $match: { user: userId } },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        pendingOrders: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        deliveredOrders: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        totalSpent: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$total', 0] } },
      },
    },
  ]);

  const recentOrders = await Order.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  res.json({
    success: true,
    kpis: {
      totalOrders: Number(summary?.totalOrders || 0),
      pendingOrders: Number(summary?.pendingOrders || 0),
      deliveredOrders: Number(summary?.deliveredOrders || 0),
      totalSpent: Number(summary?.totalSpent || 0),
      recentOrders: recentOrders.map((order) => ({
        _id: order._id,
        orderNumber: order.orderNumber,
        total: Number(order.total || 0),
        status: order.status,
        createdAt: order.createdAt,
      })),
    },
  });
}));

router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const parsed = customerOrdersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(issue ? issue.message : 'Invalid order query', 400);
    }

    const { status, page, limit } = parsed.data;
    const filter = { user: req.user._id, ...getStatusFilter(status) };
    const total = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

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
