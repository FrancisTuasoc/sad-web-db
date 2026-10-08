const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env') });

function checkEnv() {
  const missing = [];
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
    missing.push('DATABASE_URL');
  }
  if (!process.env.JWT_SECRET || !process.env.JWT_SECRET.trim()) {
    missing.push('JWT_SECRET');
  }
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_EMAIL.trim()) {
    missing.push('ADMIN_EMAIL');
  }
  if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_PASSWORD.trim()) {
    missing.push('ADMIN_PASSWORD');
  }

  if (missing.length > 0) {
    console.log(
      '\n============================================================'
    );
    console.log(' [SETUP REQUIRED] Configure required values in backend/.env');
    console.log('============================================================');
    console.log(`Missing required variables: ${missing.join(', ')}`);
    console.log(
      'Please edit casestudy-system/backend/.env and add valid values.'
    );
    console.log(
      '============================================================\n'
    );
    process.exit(1);
  }
}

module.exports = {
  checkEnv,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL:
    process.env.FRONTEND_URL || 'https://sad-web-db-frontend.vercel.app',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'Admin',
};
