const express = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  FRONTEND_URL,
  JWT_SECRET,
  BREVO_API_KEY,
  BREVO_SENDER_EMAIL,
} = require('../config/env');

const userRepository = require('../repositories/userRepository');
const pendingVerificationRepository = require('../repositories/pendingVerificationRepository');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const sendVerificationEmail = require('../utils/verificationEmail');
const createVerificationToken = require('../utils/verificationToken');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { rateLimitAuth } = require('../middleware/rateLimit');
const {
  isValidUsername,
  isValidCustomerAccount,
} = require('../utils/accountValidation');

const router = express.Router();

const registerSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters long')
      .max(20, 'Username cannot exceed 20 characters')
      .refine(
        isValidUsername,
        'Username must start with a letter and can only contain letters, numbers, and underscores'
      ),
    email: z
      .string()
      .trim()
      .email('Please enter a valid email address')
      .toLowerCase(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters long')
      .regex(/[A-Za-z]/, 'Password must contain at least one letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Please enter a valid email address')
    .toLowerCase(),
  password: z.string().min(1, 'Please enter your password'),
});

const resendVerificationSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Please enter a valid email address')
    .toLowerCase(),
});

function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
}

async function createAndEmailVerification(email, userData, requireExisting) {
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
    throw new AppError(
      'Email verification is not configured on the server. Please contact the shop.',
      503
    );
  }

  const token = createVerificationToken();
  const result = await pendingVerificationRepository.createOrReplace({
    email,
    token,
    userData,
    requireExisting,
  });

  if (result.status === 'not_found') {
    throw new AppError(
      'No pending registration was found. Please complete the registration form again.',
      404
    );
  }
  if (result.status === 'rate_limited') {
    throw new AppError(
      `Please wait ${result.retryAfter} seconds before requesting another verification email.`,
      429
    );
  }

  const verificationUrl = new URL('/verify-email.html', FRONTEND_URL);
  verificationUrl.searchParams.set('token', token);
  try {
    await sendVerificationEmail(email, verificationUrl.toString());
  } catch (error) {
    console.error('[EMAIL VERIFICATION SEND ERROR]', error.message);
    throw new AppError(
      'The verification email could not be sent. Please try again shortly.',
      502
    );
  }
}

router.get('/verification-status', (req, res) => {
  res.json({
    success: true,
    verificationEnabled: Boolean(BREVO_API_KEY && BREVO_SENDER_EMAIL),
  });
});

router.post(
  '/register',
  rateLimitAuth(10, 15),
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;

    const existingByEmail = await userRepository.findByEmail(email);
    if (existingByEmail) {
      throw new AppError(
        'An account with this email address already exists. Please log in.',
        400
      );
    }

    const existingByUsername = await userRepository.findByUsername(username);
    if (existingByUsername) {
      throw new AppError(
        'This username is already taken. Please choose another.',
        400
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const pendingUsername = await pendingVerificationRepository.findPendingUsername(
      username,
      email
    );
    if (pendingUsername) {
      throw new AppError(
        'This username is already being used for another pending registration.',
        400
      );
    }

    await createAndEmailVerification(
      email,
      { username, email, passwordHash },
      false
    );

    res.status(202).json({
      success: true,
      message:
        'A verification email has been sent to your inbox. Please click the link in the email to complete your registration.',
    });
  })
);

router.post(
  '/resend-verification',
  rateLimitAuth(10, 15),
  validate(resendVerificationSchema),
  asyncHandler(async (req, res) => {
    const email = req.body.email;
    await pendingVerificationRepository.cleanupExpired({ email });

    const existingUser = await userRepository.findByEmail(email);
    if (existingUser && existingUser.isVerified) {
      res.json({
        success: true,
        message:
          'If a pending registration exists for that email, a new verification link has been sent.',
      });
      return;
    }

    await createAndEmailVerification(email, null, true);

    res.json({
      success: true,
      message: 'A new verification email has been sent. Please check your inbox.',
    });
  })
);

router.get(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const token =
      typeof req.query.token === 'string' &&
      /^[a-f0-9]{64}$/i.test(req.query.token)
        ? req.query.token
        : null;
    await pendingVerificationRepository.cleanupExpired({ token });

    if (!token) {
      throw new AppError('The verification link is invalid or incomplete.', 400);
    }

    let result;
    try {
      result = await pendingVerificationRepository.verifyToken(token);
    } catch (error) {
      if (error.code === '23505') {
        throw new AppError(
          'This email or username is already associated with an account. Please log in or register with different details.',
          409
        );
      }
      throw error;
    }

    if (result.status === 'expired') {
      throw new AppError(
        'This verification link has expired. Enter your email below to request a new one.',
        410
      );
    }
    if (result.status === 'not_found') {
      throw new AppError(
        'This verification link is invalid or has already been used. Enter your email below to request a new one.',
        404
      );
    }

    res.json({
      success: true,
      message: 'Email verified successfully. You can now log in.',
    });
  })
);

router.post(
  '/login',
  rateLimitAuth(10, 15),
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await userRepository.findByEmail(email);
    if (!user) {
      throw new AppError('Invalid email or password.', 401);
    }

    if (user.status === 'suspended') {
      throw new AppError(
        'Your account is suspended. Please contact the shop.',
        403
      );
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Invalid email or password.', 401);
    }

    if (!user.isVerified) {
      throw new AppError(
        'Please verify your email address before logging in.',
        403
      );
    }

    if (!isValidCustomerAccount(user)) {
      throw new AppError(
        'This customer account does not meet current account requirements. Please contact the shop to update your details.',
        403
      );
    }

    const token = signToken(user.id);

    res.json({
      success: true,
      message: 'Logged in successfully!',
      token,
      user: userRepository.safeUser(user),
    });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      user: userRepository.safeUser(req.user),
    });
  })
);

module.exports = router;
