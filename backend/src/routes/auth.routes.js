const express = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userRepository = require('../repositories/userRepository');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { rateLimitAuth } = require('../middleware/rateLimit');
const { JWT_SECRET } = require('../config/env');
const {
  isValidGmailAddress,
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
      .toLowerCase()
      .refine(
        isValidGmailAddress,
        'Use a Gmail address with a 6-30 character local part containing at least 2 letters and more letters than numbers'
      ),
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

function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
}

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
    const user = await userRepository.create({
      username,
      email,
      passwordHash,
      role: 'customer',
      status: 'active',
    });

    const token = signToken(user.id);

    res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      token,
      user: userRepository.safeUser(user),
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
