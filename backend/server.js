const express = require('express');
const cors = require('cors');
const path = require('path');
const { checkEnv, PORT, MONGODB_URI, FRONTEND_URL } = require('./src/config/env');

// Validate critical environment variables before starting
checkEnv();

const { connectDB } = require('./src/config/db');
const { ensureAdminAndSettings } = require('./src/seed/seed');
const errorHandler = require('./src/middleware/errorHandler');
const { expirePayAtShopOrders } = require('./src/services/order.service');

const ORDER_EXPIRY_SWEEP_INTERVAL_MS = 60 * 1000;

// Route imports
const authRoutes = require('./src/routes/auth.routes');
const productsRoutes = require('./src/routes/products.routes');
const categoriesRoutes = require('./src/routes/categories.routes');
const cartRoutes = require('./src/routes/cart.routes');
const ordersRoutes = require('./src/routes/orders.routes');
const profileRoutes = require('./src/routes/profile.routes');
const customerAccountRoutes = require('./src/routes/customerAccount.routes');
const streamRoutes = require('./src/routes/stream.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const adminRoutes = require('./src/routes/admin.routes');

const app = express();
app.disable('x-powered-by');

const normalizeOrigin = (value) => {
  if (!value) return value;

  try {
    return new URL(value).origin;
  } catch (error) {
    return value.replace(/\/$/, '');
  }
};

const allowedOrigins = new Set([
  normalizeOrigin(FRONTEND_URL),
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].map((origin) => normalizeOrigin(origin)));

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    const normalizedOrigin = origin ? normalizeOrigin(origin) : null;

    if (!origin || allowedOrigins.has(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Static frontend serving
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/customer', customerAccountRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/admin', adminRoutes);

// 404 handler for unknown /api routes
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot find API endpoint ${req.originalUrl} on this server.`,
  });
});

// Central error handler
app.use(errorHandler);

// Connect database and start server
async function startServer() {
  await connectDB(MONGODB_URI);

  // Auto-run admin & settings seed on startup if missing
  try {
    await ensureAdminAndSettings();
  } catch (seedErr) {
    console.error('[SEED CHECK WARNING]', seedErr.message);
  }

  let expirySweepRunning = false;
  const runOrderExpirySweep = async () => {
    if (expirySweepRunning) return;
    expirySweepRunning = true;
    try {
      const cancelledCount = await expirePayAtShopOrders();
      if (cancelledCount > 0) {
        console.log(`[ORDER EXPIRY] Automatically cancelled ${cancelledCount} overdue pay-at-shop order(s).`);
      }
    } catch (error) {
      console.error('[ORDER EXPIRY ERROR]', error);
    } finally {
      expirySweepRunning = false;
    }
  };
  await runOrderExpirySweep();
  setInterval(runOrderExpirySweep, ORDER_EXPIRY_SWEEP_INTERVAL_MS);

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n============================================================`);
    console.log(` Burger Ordering & Billing Server running at: http://localhost:${PORT}`);
    console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`============================================================\n`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down server gracefully...');
    server.close(() => {
      console.log('Server process terminated.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
