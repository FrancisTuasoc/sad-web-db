const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const emptyToUndefined = (value) => (value === '' ? undefined : value);

const envSchema = z.object({
  DATABASE_URL: z.string().trim().min(1, 'Required'),
  JWT_SECRET: z.string().trim().min(1, 'Required'),
  PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(65535).default(5000)
  ),
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'test', 'production']).default('development')
  ),
  CORS_ORIGINS: z
    .preprocess(emptyToUndefined, z.string().default(''))
    .transform((origins) =>
      origins
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    )
    .pipe(
      z
        .array(z.string().url())
        .transform((origins) => origins.map((origin) => new URL(origin).origin))
    ),
  ADMIN_EMAIL: z.string().trim().email(),
  ADMIN_PASSWORD: z.string().refine((value) => value.trim().length > 0, {
    message: 'Required',
  }),
  ADMIN_USERNAME: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).default('Admin')
  ),
});

const validation = envSchema.safeParse(process.env);

function checkEnv() {
  if (validation.success) {
    return;
  }

  console.log('\n============================================================');
  console.log(' [SETUP REQUIRED] Configure required values in backend/.env');
  console.log('============================================================');
  console.log('Invalid environment variables:');
  for (const issue of validation.error.issues) {
    console.log(`- ${issue.path.join('.')}: ${issue.message}`);
  }
  console.log(
    'Please edit casestudy-system/backend/.env and add valid values.'
  );
  console.log('============================================================\n');
  process.exit(1);
  throw validation.error;
}

checkEnv();

const env = validation.data;

module.exports = {
  checkEnv,
  DATABASE_URL: env.DATABASE_URL,
  JWT_SECRET: env.JWT_SECRET,
  PORT: env.PORT,
  NODE_ENV: env.NODE_ENV,
  CORS_ORIGINS: env.CORS_ORIGINS,
  ADMIN_EMAIL: env.ADMIN_EMAIL,
  ADMIN_PASSWORD: env.ADMIN_PASSWORD,
  ADMIN_USERNAME: env.ADMIN_USERNAME,
};
