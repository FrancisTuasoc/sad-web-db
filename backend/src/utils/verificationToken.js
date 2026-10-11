const { randomBytes } = require('crypto');

function createVerificationToken() {
  return randomBytes(32).toString('hex');
}

module.exports = createVerificationToken;
