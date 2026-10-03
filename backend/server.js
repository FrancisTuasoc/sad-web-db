const express = require('express');
const cors = require('cors');
const path = require('path');
const { checkEnv, PORT, MONGODB_URI } = require('./src/config/env');

// Validate critical environment variables before starting
checkEnv();

const { connectDB } = require('./src/config/db');
const { ensureAdminAndSettings } = require('./src/seed/seed');
const errorHandler = require('./src/middleware/errorHandler');

// Route imports
const authRoutes = require('./src/routes/auth.routes');
const productsRoutes = require('./src/routes/products.routes');
const categoriesRoutes = require('./src/routes/categories.routes');
const cartRoutes = require('./src/routes/cart.routes');
const ordersRoutes = require('./src/routes/orders.routes');
const profileRoutes = require('./src/routes/profile.routes');
const streamRoutes = require('./src/routes/stream.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const adminRoutes = require('./src/routes/admin.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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
