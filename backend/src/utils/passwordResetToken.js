const crypto = require('node:crypto');

function createPasswordResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { createPasswordResetToken, hashPasswordResetToken };
