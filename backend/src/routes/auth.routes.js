const express = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  FRONTEND_URL,
  JWT_SECRET,
  BREVO_API_KEY,
  BREVO_SENDER_EMAIL,
  PASSWORD_RESET_EMAIL_ENABLED,
  PASSWORD_RESET_API_KEY,
} = require('../config/env');

const userRepository = require('../repositories/userRepository');
const passwordResetRepository = require('../repositories/passwordResetRepository');
const pendingVerificationRepository = require('../repositories/pendingVerificationRepository');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const sendVerificationEmail = require('../utils/verificationEmail');
const sendPasswordResetEmail = require('../utils/passwordResetEmail');
const createVerificationToken = require('../utils/verificationToken');
const {
  createPasswordResetToken,
  hashPasswordResetToken,
} = require('../utils/passwordResetToken');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { rateLimitAuth } = require('../middleware/rateLimit');
const {
  isValidUsername,
  isValidCustomerAccount,
} = require('../utils/accountValidation');

const router = express.Router();

function buildBaseUsername(firstName, lastName, email) {
  const cleanFirst = (firstName || '').replace(/[^a-zA-Z0-9]/g, '');
  const cleanLast = (lastName || '').replace(/[^a-zA-Z0-9]/g, '');
  let base = `${cleanFirst}${cleanLast}`.toLowerCase();

  if (!base || !/^[a-zA-Z]/.test(base)) {
    const emailPrefix = (email || '')
      .split('@')[0]
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
    base = /^[a-zA-Z]/.test(emailPrefix)
      ? emailPrefix
      : `user${cleanFirst || cleanLast || ''}`;
  }
  if (!/^[a-zA-Z]/.test(base)) {
    base = `u${base}`;
  }
  base = base.slice(0, 14);
  if (base.length < 3) {
    base = (base + 'gigabite').slice(0, 14);
  }
  return base;
}

const registerSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, 'First name is required')
      .max(100, 'First name cannot exceed 100 characters')
      .optional(),
    lastName: z
      .string()
      .trim()
      .min(1, 'Last name is required')
      .max(100, 'Last name cannot exceed 100 characters')
      .optional(),
    username: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters long')
      .max(20, 'Username cannot exceed 20 characters')
      .refine(
        isValidUsername,
        'Username must start with a letter and can only contain letters, numbers, and underscores'
      )
      .optional(),
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
  })
  .refine(
    (data) =>
      Boolean(
        (data.username && data.username.trim()) ||
          (data.firstName &&
            data.firstName.trim() &&
            data.lastName &&
            data.lastName.trim())
      ),
    {
      message: 'Please provide both first name and last name.',
      path: ['firstName'],
    }
  );

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

const passwordResetRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Please enter a valid email address')
    .max(254)
    .toLowerCase(),
});

const passwordResetTokenSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i, 'The reset link is invalid.'),
});

const passwordResetSchema = passwordResetTokenSchema.extend({
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
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
  '/password-reset/request',
  rateLimitAuth(5, 15),
  validate(passwordResetRequestSchema),
  asyncHandler(async (req, res) => {
    if (!PASSWORD_RESET_EMAIL_ENABLED) {
      throw new AppError(
        'Password recovery email is not enabled yet. Please contact the shop.',
        503
      );
    }
    const resetApiKey = PASSWORD_RESET_API_KEY || BREVO_API_KEY;
    if (!resetApiKey || !BREVO_SENDER_EMAIL) {
      throw new AppError(
        'Password recovery email is not configured on the server. Please contact the shop.',
        503
      );
    }

    const user = await userRepository.findByEmail(req.body.email);
    if (user && user.isVerified) {
      const token = createPasswordResetToken();
      const tokenHash = hashPasswordResetToken(token);
      const result = await passwordResetRepository.createOrReplace(
        user.id,
        tokenHash
      );
      if (result.status === 'created') {
        const resetUrl = new URL('/reset-password.html', FRONTEND_URL);
        resetUrl.searchParams.set('token', token);
        try {
          await sendPasswordResetEmail(user.email, resetUrl.toString());
        } catch (error) {
          await passwordResetRepository.remove(tokenHash);
          console.error('[PASSWORD RESET EMAIL SEND ERROR]', error.message);
        }
      }
    }

    res.status(202).json({
      success: true,
      message:
        'If an eligible account exists for that email, a password reset link will be sent.',
    });
  })
);

router.post(
  '/password-reset/validate',
  rateLimitAuth(30, 15),
  validate(passwordResetTokenSchema),
  asyncHandler(async (req, res) => {
    const valid = await passwordResetRepository.isValid(
      hashPasswordResetToken(req.body.token)
    );
    if (!valid) {
      throw new AppError(
        'This password reset link is invalid, expired, or already used.',
        410
      );
    }
    res.json({ success: true });
  })
);

router.post(
  '/password-reset/confirm',
  rateLimitAuth(10, 15),
  validate(passwordResetSchema),
  asyncHandler(async (req, res) => {
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const result = await passwordResetRepository.resetPassword(
      hashPasswordResetToken(req.body.token),
      passwordHash
    );
    if (result.status !== 'reset') {
      throw new AppError(
        'This password reset link is invalid, expired, or already used.',
        410
      );
    }
    res.json({
      success: true,
      message: 'Your password has been reset. You can now log in.',
    });
  })
);

router.post(
  '/register',
  rateLimitAuth(10, 15),
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    let { username, firstName, lastName, email, password } = req.body;
    firstName = firstName ? firstName.trim() : '';
    lastName = lastName ? lastName.trim() : '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ');

    const existingByEmail = await userRepository.findByEmail(email);
    if (existingByEmail) {
      throw new AppError(
        'An account with this email address already exists. Please log in.',
        400
      );
    }

    if (username && username.trim()) {
      username = username.trim();
      const existingByUsername = await userRepository.findByUsername(username);
      if (existingByUsername) {
        throw new AppError(
          'This username is already taken. Please choose another.',
          400
        );
      }

      const pendingUsername =
        await pendingVerificationRepository.findPendingUsername(
          username,
          email
        );
      if (pendingUsername) {
        throw new AppError(
          'This username is already being used for another pending registration.',
          400
        );
      }
    } else {
      const base = buildBaseUsername(firstName, lastName, email);
      username = base;
      let counter = 1;
      while (
        (await userRepository.findByUsername(username)) ||
        (await pendingVerificationRepository.findPendingUsername(
          username,
          email
        ))
      ) {
        const suffix = String(counter);
        username = `${base.slice(0, 20 - suffix.length)}${suffix}`;
        counter++;
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await createAndEmailVerification(
      email,
      {
        username,
        firstName,
        lastName,
        fullName,
        email,
        passwordHash,
      },
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
