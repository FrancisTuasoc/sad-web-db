const express = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');

const { query } = require('../config/db');
const orderRepository = require('../repositories/orderRepository');
const productRepository = require('../repositories/productRepository');
const categoryRepository = require('../repositories/categoryRepository');
const userRepository = require('../repositories/userRepository');
const settingsRepository = require('../repositories/settingsRepository');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getDashboardStats } = require('../services/stats.service');
const {
  cancelOrder,
  updateOrderStatus,
  markOrderPaid,
} = require('../services/order.service');
const { broadcastStock } = require('../services/events');

const router = express.Router();
router.use(requireAuth, requireAdmin);

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// -------------------------------------------------------------
// 1. DASHBOARD STATS
// -------------------------------------------------------------
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const stats = await getDashboardStats();
    res.json({ success: true, stats });
  })
);

// -------------------------------------------------------------
// 2. ORDERS MANAGEMENT
// -------------------------------------------------------------
router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const {
      search,
      status,
      paymentStatus,
      fulfillment,
      dateRange,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }
    if (paymentStatus && paymentStatus !== 'all') {
      filter.paymentStatus = paymentStatus;
    }
    if (fulfillment && fulfillment !== 'all') {
      filter.fulfillment = fulfillment;
    }
    if (search && search.trim()) {
      filter.search = search.trim();
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    const [orders, total] = await Promise.all([
      orderRepository.find(filter, { limit: limitNum, offset: skip }),
      orderRepository.count(filter),
    ]);

    res.json({
      success: true,
      orders,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  })
);

router.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const order = await orderRepository.findById(req.params.id);
    if (!order) {
      throw new AppError('Order not found', 404);
    }
    res.json({ success: true, order });
  })
);

router.patch(
  '/orders/:id/status',
  validate(
    z.object({
      status: z.enum([
        'preparing',
        'ready_for_pickup',
        'ready_to_deliver',
        'completed',
      ]),
    })
  ),
  asyncHandler(async (req, res) => {
    const updated = await updateOrderStatus(req.params.id, req.body.status);
    res.json({
      success: true,
      message: `Order status updated to ${req.body.status}`,
      order: updated,
    });
  })
);

router.patch(
  '/orders/:id/cancel',
  asyncHandler(async (req, res) => {
    const order = await cancelOrder(req.params.id, req.user, 'admin');
    res.json({
      success: true,
      message: 'Order has been successfully cancelled.',
      order,
    });
  })
);

router.patch(
  '/orders/:id/paid',
  asyncHandler(async (req, res) => {
    const updated = await markOrderPaid(req.params.id);
    res.json({
      success: true,
      message: 'Order marked as paid',
      order: updated,
    });
  })
);

// -------------------------------------------------------------
// 3. PRODUCTS & ADDONS MANAGEMENT
// -------------------------------------------------------------
const productSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  price: z.number().min(0, 'Price must be 0 or greater'),
  description: z.string().trim().optional().default(''),
  stock: z.number().int().min(0, 'Stock cannot be negative').default(0),
  lowStockThreshold: z.number().int().min(0).default(10),
  category: z.string().min(1, 'Category is required'),
  image: z
    .string()
    .max(600000, 'Image data exceeds maximum size (approx 400KB)')
    .optional()
    .default(''),
  isAddon: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
});

router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const { category, search, stockFilter } = req.query;
    let products = await productRepository.find({
      category: category && category !== 'all' ? category : undefined,
      search,
    });

    if (stockFilter === 'low') {
      products = products.filter((p) => p.stock <= p.lowStockThreshold);
    } else if (stockFilter === 'out') {
      products = products.filter((p) => p.stock === 0);
    }

    products.sort((a, b) => {
      if (a.isAddon !== b.isAddon) return a.isAddon ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    res.json({ success: true, products });
  })
);

router.post(
  '/products',
  validate(productSchema),
  asyncHandler(async (req, res) => {
    let baseSlug = slugify(req.body.name);
    let slug = baseSlug;
    let count = 1;
    while (await productRepository.findBySlug(slug)) {
      slug = `${baseSlug}-${count++}`;
    }

    const product = await productRepository.create({
      ...req.body,
      slug,
      image: req.body.image || `assets/items/${slug}.png`,
    });

    broadcastStock(product.id, product.stock, product.isAvailable);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product,
    });
  })
);

router.put(
  '/products/:id',
  validate(productSchema),
  asyncHandler(async (req, res) => {
    const existing = await productRepository.findById(req.params.id);
    if (!existing) {
      throw new AppError('Product not found', 404);
    }

    const updated = await productRepository.update(req.params.id, {
      name: req.body.name,
      price: req.body.price,
      description: req.body.description,
      stock: req.body.stock,
      lowStockThreshold: req.body.lowStockThreshold,
      category: req.body.category,
      isAddon: req.body.isAddon,
      isAvailable: req.body.isAvailable,
      isFeatured: req.body.isFeatured,
      image: req.body.image || existing.image,
    });

    broadcastStock(updated.id, updated.stock, updated.isAvailable);

    res.json({
      success: true,
      message: 'Product updated successfully',
      product: updated,
    });
  })
);

router.patch(
  '/products/:id/stock',
  validate(
    z.object({
      mode: z.enum(['set', 'add']),
      amount: z.number().int(),
    })
  ),
  asyncHandler(async (req, res) => {
    const product = await productRepository.findById(req.params.id);
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    let nextStock = product.stock;
    if (req.body.mode === 'set') {
      if (req.body.amount < 0) {
        throw new AppError('Stock cannot be set to a negative number', 400);
      }
      nextStock = req.body.amount;
    } else {
      nextStock = product.stock + req.body.amount;
      if (nextStock < 0) {
        throw new AppError('Resulting stock cannot be negative', 400);
      }
    }

    const updated = await productRepository.update(req.params.id, {
      stock: nextStock,
    });
    broadcastStock(updated.id, updated.stock, updated.isAvailable);

    res.json({
      success: true,
      message: `Stock updated to ${updated.stock}`,
      product: updated,
    });
  })
);

router.patch(
  '/products/:id/availability',
  asyncHandler(async (req, res) => {
    const product = await productRepository.findById(req.params.id);
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    const updated = await productRepository.update(req.params.id, {
      isAvailable: !product.isAvailable,
    });

    broadcastStock(updated.id, updated.stock, updated.isAvailable);

    res.json({
      success: true,
      message: `Item marked as ${updated.isAvailable ? 'available' : 'unavailable'}`,
      product: updated,
    });
  })
);

router.delete(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const product = await productRepository.findById(req.params.id);
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    await productRepository.delete(req.params.id);

    // Broadcast stock 0 / unavailable
    broadcastStock(product.id, 0, false);

    res.json({
      success: true,
      message:
        'Product deleted permanently and removed from active shopping carts.',
    });
  })
);

// -------------------------------------------------------------
// 4. CATEGORIES MANAGEMENT
// -------------------------------------------------------------
router.post(
  '/categories',
  validate(
    z.object({
      name: z.string().trim().min(1, 'Category name is required'),
      sortOrder: z.number().int().default(0),
    })
  ),
  asyncHandler(async (req, res) => {
    const exists = await categoryRepository.findByName(req.body.name.trim());
    if (exists) {
      throw new AppError('A category with that name already exists.', 400);
    }

    const category = await categoryRepository.create({
      name: req.body.name.trim(),
      sortOrder: req.body.sortOrder,
    });

    res.status(201).json({
      success: true,
      message: 'Category created.',
      category,
    });
  })
);

router.put(
  '/categories/:id',
  validate(
    z.object({
      name: z.string().trim().min(1, 'Category name is required'),
      sortOrder: z.number().int().default(0),
    })
  ),
  asyncHandler(async (req, res) => {
    const category = await categoryRepository.findById(req.params.id);
    if (!category) {
      throw new AppError('Category not found', 404);
    }

    const updated = await categoryRepository.update(req.params.id, {
      name: req.body.name.trim(),
      sortOrder: req.body.sortOrder,
    });

    res.json({
      success: true,
      message: 'Category updated.',
      category: updated,
    });
  })
);

router.delete(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const productsInCat = await query(
      'SELECT COUNT(*)::int as count FROM products WHERE category_id = $1',
      [req.params.id]
    );
    const inUse = productsInCat.rows[0].count;
    if (inUse > 0) {
      throw new AppError(
        `Cannot delete this category because ${inUse} product(s) are still assigned to it. Please reassign or delete them first.`,
        400
      );
    }

    const deleted = await categoryRepository.delete(req.params.id);
    if (!deleted) {
      throw new AppError('Category not found', 404);
    }

    res.json({
      success: true,
      message: 'Category deleted.',
    });
  })
);

// -------------------------------------------------------------
// 5. CUSTOMERS MANAGEMENT
// -------------------------------------------------------------
router.get(
  '/customers',
  asyncHandler(async (req, res) => {
    const { search } = req.query;

    let sql = `
      SELECT 
        u.*,
        COUNT(o.id)::int as order_count,
        COALESCE(SUM(o.total), 0)::numeric as total_spent
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      WHERE u.role = 'customer'
    `;
    const params = [];

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      sql += ` AND (
        u.username ILIKE $${params.length} OR
        u.email ILIKE $${params.length} OR
        u.contact_email ILIKE $${params.length} OR
        u.first_name ILIKE $${params.length} OR
        u.last_name ILIKE $${params.length} OR
        u.full_name ILIKE $${params.length} OR
        u.phone ILIKE $${params.length}
      )`;
    }

    sql += ' GROUP BY u.id ORDER BY u.created_at DESC';

    const result = await query(sql, params);

    const customerList = result.rows.map((c) => ({
      _id: c.id,
      id: c.id,
      username: c.username,
      email: c.email,
      contactEmail: c.contact_email || c.email,
      firstName: c.first_name,
      lastName: c.last_name,
      fullName: c.full_name,
      phone: c.phone,
      street: c.street,
      barangay: c.barangay,
      city: c.city,
      province: c.province,
      postalCode: c.postal_code,
      address: c.address,
      status: c.status,
      createdAt: c.created_at,
      orderCount: c.order_count,
      totalSpent: Number(c.total_spent),
    }));

    res.json({
      success: true,
      customers: customerList,
    });
  })
);

router.get(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    const customer = await userRepository.findById(req.params.id);
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const orders = await orderRepository.find({ userId: customer.id });

    res.json({
      success: true,
      customer: userRepository.safeUser(customer),
      orders,
    });
  })
);

router.patch(
  '/customers/:id/status',
  validate(z.object({ status: z.enum(['active', 'suspended']) })),
  asyncHandler(async (req, res) => {
    const customer = await userRepository.findById(req.params.id);
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    if (customer.role === 'admin') {
      throw new AppError('Cannot suspend an administrator account.', 400);
    }

    const updated = await userRepository.update(req.params.id, {
      status: req.body.status,
    });

    res.json({
      success: true,
      message: `Customer account has been ${req.body.status === 'suspended' ? 'suspended' : 'reactivated'}.`,
      customer: userRepository.safeUser(updated),
    });
  })
);

// -------------------------------------------------------------
// 6. SETTINGS MANAGEMENT
// -------------------------------------------------------------
router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const settings = await settingsRepository.getSettings();
    res.json({ success: true, settings });
  })
);

router.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const fields = [
      'storeName',
      'tagline',
      'address',
      'phone',
      'email',
      'businessHours',
      'deliveryFee',
      'deliveryEnabled',
      'pickupEnabled',
      'gcashEnabled',
      'codEnabled',
      'payAtShopEnabled',
      'gcashName',
      'gcashNumber',
      'acceptingOrders',
      'minimumOrder',
    ];

    const updates = {};
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates[f] = req.body[f];
      }
    }

    const settings = await settingsRepository.update(updates);

    res.json({
      success: true,
      message: 'Store settings updated successfully.',
      settings,
    });
  })
);

// -------------------------------------------------------------
// 7. ADMIN PROFILE & SECURITY
// -------------------------------------------------------------
router.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const admin = await userRepository.findById(req.user.id);
    res.json({ success: true, admin: userRepository.safeUser(admin) });
  })
);

router.patch(
  '/profile',
  validate(
    z.object({
      username: z.string().trim().min(3).max(20).optional(),
      email: z.string().trim().email().toLowerCase().optional(),
      fullName: z.string().trim().optional(),
      phone: z.string().trim().optional(),
      address: z.string().trim().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const admin = await userRepository.findById(req.user.id);

    if (req.body.username && req.body.username !== admin.username) {
      const taken = await userRepository.findByUsername(req.body.username);
      if (taken && taken.id !== admin.id)
        throw new AppError('Username is already taken', 400);
    }

    if (req.body.email && req.body.email !== admin.email) {
      const taken = await userRepository.findByEmail(req.body.email);
      if (taken && taken.id !== admin.id)
        throw new AppError('Email is already taken', 400);
    }

    const updates = {};
    if (req.body.username !== undefined) updates.username = req.body.username;
    if (req.body.email !== undefined) updates.email = req.body.email;
    if (req.body.fullName !== undefined) updates.fullName = req.body.fullName;
    if (req.body.phone !== undefined) updates.phone = req.body.phone;
    if (req.body.address !== undefined) updates.address = req.body.address;

    const updated = await userRepository.update(req.user.id, updates);
    res.json({
      success: true,
      message: 'Admin profile updated',
      admin: userRepository.safeUser(updated),
    });
  })
);

router.patch(
  '/password',
  validate(
    z
      .object({
        currentPassword: z.string().min(1, 'Please enter current password'),
        newPassword: z
          .string()
          .min(8, 'New password must be at least 8 characters long')
          .regex(/[A-Za-z]/, 'Password must contain at least one letter')
          .regex(/[0-9]/, 'Password must contain at least one number'),
        confirmPassword: z.string(),
      })
      .refine((data) => data.newPassword === data.confirmPassword, {
        message: 'New passwords do not match',
        path: ['confirmPassword'],
      })
  ),
  asyncHandler(async (req, res) => {
    const admin = await userRepository.findById(req.user.id);
    const isMatch = await bcrypt.compare(
      req.body.currentPassword,
      admin.passwordHash
    );
    if (!isMatch) {
      throw new AppError('Incorrect current password.', 400);
    }

    const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    await userRepository.update(req.user.id, { passwordHash });

    res.json({ success: true, message: 'Password updated successfully' });
  })
);

module.exports = router;
