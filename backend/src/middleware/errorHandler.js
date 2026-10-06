const AppError = require('../utils/AppError');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Something went wrong. Please try again.';

  if (statusCode === 413 || err.type === 'entity.too.large') {
    statusCode = 413;
    message = req.path === '/avatar' || req.path.endsWith('/profile/avatar')
      ? 'Photo must be 5 MiB or smaller.'
      : 'Request body is too large.';
  }

  if (statusCode === 429 && (req.path === '/avatar' || req.path.endsWith('/profile/avatar'))) {
    message = 'You have reached the photo upload limit. Please try again in an hour.';
  }

  if (statusCode === 507) {
    message = 'Avatar storage is full. Please contact the administrator before uploading another photo.';
  }

  // Handle Mongoose CastError (e.g. invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }

  // Handle Mongoose duplicate key error (code 11000)
  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    const val = err.keyValue ? err.keyValue[field] : '';
    message = `The ${field} "${val}" is already taken. Please use a different value.`;
  }

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    const messages = Object.values(err.errors).map((el) => el.message);
    message = messages[0] || 'Validation error';
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token. Please log in again.';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Your session has expired. Please log in again.';
  }

  // Log unknown server errors only to console
  if (statusCode === 500) {
    console.error('SERVER ERROR:', err);
    message = 'Something went wrong. Please try again.';
  }

  res.status(statusCode).json({
    success: false,
    message,
  });
};

module.exports = errorHandler;
