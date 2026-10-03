const AppError = require('../utils/AppError');

const validate = (schema) => (req, res, next) => {
  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const message = firstIssue ? firstIssue.message : 'Invalid request data';
      return next(new AppError(message, 400));
    }
    req.body = parsed.data;
    next();
  } catch (error) {
    next(new AppError('Validation failed', 400));
  }
};

module.exports = validate;
