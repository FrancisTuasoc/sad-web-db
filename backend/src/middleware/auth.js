const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/userRepository');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { JWT_SECRET } = require('../config/env');

const requireAuth = asyncHandler(async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('Please log in to continue.', 401));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return next(
      new AppError('Your session has expired. Please log in again.', 401)
    );
  }

  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!decoded.id || !UUID_REGEX.test(decoded.id)) {
    return next(
      new AppError('Your session has expired. Please log in again.', 401)
    );
  }

  const user = await userRepository.findById(decoded.id);
  if (!user) {
    return next(new AppError('Account not found or session invalid.', 401));
  }

  if (user.status === 'suspended') {
    return next(
      new AppError('Your account is suspended. Please contact the shop.', 403)
    );
  }

  req.user = user;
  next();
});

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return next(new AppError('Admin access required. Forbidden.', 403));
  }
  next();
};

module.exports = { requireAuth, requireAdmin };
