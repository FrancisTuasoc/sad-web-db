const express = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');

const Order = require('../models/Order');
const Product = require('../models/Product');
const Category = require('../models/Category');
const CartItem = require('../models/CartItem');
const User = require('../models/User');
const Settings = require('../models/Settings');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getDashboardStats } = require('../services/stats.service');
const { cancelOrder, updateOrderStatus, markOrderPaid } = require('../services/order.service');
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

    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }
    if (paymentStatus && paymentStatus !== 'all') {
      query.paymentStatus = paymentStatus;
    }
    if (fulfillment && fulfillment !== 'all') {
      query.fulfillment = fulfillment;
    }

    if (search && search.trim()) {
      const s = search.trim();
      query.$or = [
        { orderNumber: { $regex: s, $options: 'i' } },
        { 'contact.fullName': { $regex: s, $options: 'i' } },
        { 'contact.email': { $regex: s, $options: 'i' } },
        { 'contact.phone': { $regex: s, $options: 'i' } },
        { gcashReference: { $regex: s, $options: 'i' } },
      ];
    }

    if (dateRange) {
      const now = new Date();
      if (dateRange === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        query.createdAt = { $gte: start };
      } else if (dateRange === 'week') {
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        query.createdAt = { $gte: start };
      } else if (dateRange === 'month') {
        const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        query.createdAt = { $gte: start };
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    const [orders, total] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).populate('user', 'username email'),
      Order.countDocuments(query),
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
    const order = await Order.findById(req.params.id).populate('user', 'username email');
    if (!order) {
      throw new AppError('Order not found', 404);
    }
    res.json({ success: true, order });
  })
);

router.patch(
  '/orders/:id/status',
  validate(z.object({ status: z.enum(['preparing', 'ready_for_pickup', 'ready_to_deliver', 'completed']) })),
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
  image: z.string().max(600000, 'Image data exceeds maximum size (approx 400KB)').optional().default(''),
  isAddon: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
});

router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const { category, search, stockFilter } = req.query;
    const query = {};

    if (category && category !== 'all') {
      query.category = category;
    }
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }
    if (stockFilter === 'low') {
      query.$expr = { $lte: ['$stock', '$lowStockThreshold'] };
    } else if (stockFilter === 'out') {
      query.stock = 0;
    }

    const products = await Product.find(query).populate('category').sort({ isAddon: 1, name: 1 });
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
    while (await Product.findOne({ slug })) {
      slug = `${baseSlug}-${count++}`;
    }

    const product = await Product.create({
      ...req.body,
      slug,
      image: req.body.image || `assets/items/${slug}.png`,
    });

    broadcastStock(product._id, product.stock, product.isAvailable);

    const populated = await Product.findById(product._id).populate('category');
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product: populated,
    });
  })
);

router.put(
  '/products/:id',
  validate(productSchema),
  asyncHandler(async (req, res) => {
    const existing = await Product.findById(req.params.id);
    if (!existing) {
      throw new AppError('Product not found', 404);
    }

    existing.name = req.body.name;
    existing.price = req.body.price;
    existing.description = req.body.description;
    existing.stock = req.body.stock;
    existing.lowStockThreshold = req.body.lowStockThreshold;
    existing.category = req.body.category;
    existing.isAddon = req.body.isAddon;
    existing.isAvailable = req.body.isAvailable;
    existing.isFeatured = req.body.isFeatured;
    if (req.body.image) {
      existing.image = req.body.image;
    }

    await existing.save();

    broadcastStock(existing._id, existing.stock, existing.isAvailable);

    const populated = await Product.findById(existing._id).populate('category');
    res.json({
      success: true,
      message: 'Product updated successfully',
      product: populated,
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
    const product = await Product.findById(req.params.id);
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    if (req.body.mode === 'set') {
      if (req.body.amount < 0) {
        throw new AppError('Stock cannot be set to a negative number', 400);
      }
      product.stock = req.body.amount;
    } else {
      const nextStock = product.stock + req.body.amount;
      if (nextStock < 0) {
        throw new AppError('Resulting stock cannot be negative', 400);
      }
      product.stock = nextStock;
    }

    await product.save();
    broadcastStock(product._id, product.stock, product.isAvailable);

    res.json({
      success: true,
      message: `Stock updated to ${product.stock}`,
      product,
    });
  })
);

router.patch(
  '/products/:id/availability',
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    product.isAvailable = !product.isAvailable;
    await product.save();

    broadcastStock(product._id, product.stock, product.isAvailable);

    res.json({
      success: true,
      message: `Item marked as ${product.isAvailable ? 'available' : 'unavailable'}`,
      product,
    });
  })
);

router.delete(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    // Clean up from user carts
    await CartItem.deleteMany({ product: req.params.id });
    await CartItem.updateMany(
      {},
      { $pull: { addons: { product: req.params.id } } }
    );

    // Broadcast that it's no longer available
    broadcastStock(product._id, 0, false);

    res.json({
      success: true,
      message: 'Product deleted permanently and removed from active shopping carts.',
    });
  })
);

// -------------------------------------------------------------
// 4. CATEGORIES MANAGEMENT
// -------------------------------------------------------------
router.post(
  '/categories',
  validate(z.object({ name: z.string().trim().min(1, 'Category name is required'), sortOrder: z.number().int().default(0) })),
  asyncHandler(async (req, res) => {
    const exists = await Category.findOne({ name: req.body.name.trim() });
    if (exists) {
      throw new AppError('A category with that name already exists.', 400);
    }

    const category = await Category.create({
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
  validate(z.object({ name: z.string().trim().min(1, 'Category name is required'), sortOrder: z.number().int().default(0) })),
  asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);
    if (!category) {
      throw new AppError('Category not found', 404);
    }

    category.name = req.body.name.trim();
    category.sortOrder = req.body.sortOrder;
    await category.save();

    res.json({
      success: true,
      message: 'Category updated.',
      category,
    });
  })
);

router.delete(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const inUse = await Product.countDocuments({ category: req.params.id });
    if (inUse > 0) {
      throw new AppError(
        `Cannot delete this category because ${inUse} product(s) are still assigned to it. Please reassign or delete them first.`,
        400
      );
    }

    const deleted = await Category.findByIdAndDelete(req.params.id);
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
    const query = { role: 'customer' };

    if (search && search.trim()) {
      const s = search.trim();
      query.$or = [
        { username: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
        { contactEmail: { $regex: s, $options: 'i' } },
        { firstName: { $regex: s, $options: 'i' } },
        { lastName: { $regex: s, $options: 'i' } },
        { fullName: { $regex: s, $options: 'i' } },
        { phone: { $regex: s, $options: 'i' } },
      ];
    }

    const customers = await User.find(query).sort({ createdAt: -1 });

    // Aggregate order counts per customer
    const orderCounts = await Order.aggregate([
      { $group: { _id: '$user', count: { $sum: 1 }, totalSpent: { $sum: '$total' } } },
    ]);
    const orderMap = new Map();
    for (const item of orderCounts) {
      orderMap.set(String(item._id), { count: item.count, totalSpent: item.totalSpent });
    }

    const customerList = customers.map((c) => {
      const stats = orderMap.get(String(c._id)) || { count: 0, totalSpent: 0 };
      return {
        _id: c._id,
        username: c.username,
        email: c.email,
        contactEmail: c.contactEmail || c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        fullName: c.fullName,
        phone: c.phone,
        street: c.street,
        barangay: c.barangay,
        city: c.city,
        province: c.province,
        postalCode: c.postalCode,
        address: c.address,
        status: c.status,
        createdAt: c.createdAt,
        orderCount: stats.count,
        totalSpent: stats.totalSpent,
      };
    });

    res.json({
      success: true,
      customers: customerList,
    });
  })
);

router.get(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    const customer = await User.findById(req.params.id);
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const orders = await Order.find({ user: customer._id }).sort({ createdAt: -1 });

    res.json({
      success: true,
      customer,
      orders,
    });
  })
);

router.patch(
  '/customers/:id/status',
  validate(z.object({ status: z.enum(['active', 'suspended']) })),
  asyncHandler(async (req, res) => {
    const customer = await User.findById(req.params.id);
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    if (customer.role === 'admin') {
      throw new AppError('Cannot suspend an administrator account.', 400);
    }

    customer.status = req.body.status;
    await customer.save();

    res.json({
      success: true,
      message: `Customer account has been ${req.body.status === 'suspended' ? 'suspended' : 'reactivated'}.`,
      customer,
    });
  })
);

// -------------------------------------------------------------
// 6. SETTINGS MANAGEMENT
// -------------------------------------------------------------
router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    res.json({ success: true, settings });
  })
);

router.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }

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

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        settings[f] = req.body[f];
      }
    }

    await settings.save();

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
    const admin = await User.findById(req.user._id);
    res.json({ success: true, admin });
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
    const admin = await User.findById(req.user._id);

    if (req.body.username && req.body.username !== admin.username) {
      const taken = await User.findOne({ username: req.body.username });
      if (taken) throw new AppError('Username is already taken', 400);
      admin.username = req.body.username;
    }

    if (req.body.email && req.body.email !== admin.email) {
      const taken = await User.findOne({ email: req.body.email });
      if (taken) throw new AppError('Email is already taken', 400);
      admin.email = req.body.email;
    }

    if (req.body.fullName !== undefined) admin.fullName = req.body.fullName;
    if (req.body.phone !== undefined) admin.phone = req.body.phone;
    if (req.body.address !== undefined) admin.address = req.body.address;

    await admin.save();
    res.json({ success: true, message: 'Admin profile updated', admin });
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
    const admin = await User.findById(req.user._id);
    const isMatch = await bcrypt.compare(req.body.currentPassword, admin.passwordHash);
    if (!isMatch) {
      throw new AppError('Incorrect current password.', 400);
    }

    admin.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    await admin.save();

    res.json({ success: true, message: 'Password updated successfully' });
  })
);

module.exports = router;
