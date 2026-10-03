const AppError = require('../utils/AppError');

const ipHits = new Map();

// Periodic cleanup every 10 minutes to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipHits.entries()) {
    if (now > data.resetTime) {
      ipHits.delete(ip);
    }
  }
}, 10 * 60 * 1000);

const rateLimitAuth = (maxAttempts = 10, windowMinutes = 15) => {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown-ip';
    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;

    let record = ipHits.get(ip);
    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      ipHits.set(ip, record);
      return next();
    }

    record.count += 1;
    if (record.count > maxAttempts) {
      const waitMinutes = Math.ceil((record.resetTime - now) / (60 * 1000));
      return next(
        new AppError(`Too many login/registration attempts from this device. Please try again in ${waitMinutes} minute(s).`, 429)
      );
    }

    next();
  };
};

module.exports = { rateLimitAuth };
