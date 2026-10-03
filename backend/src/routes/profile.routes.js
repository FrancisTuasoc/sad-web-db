const express = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const updateProfileSchema = z.object({
  fullName: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(300).optional(),
  avatarUrl: z
    .string()
    .max(450000, 'Profile image size exceeds the 300KB limit')
    .optional(),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Please enter your current password'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters long')
      .regex(/[A-Za-z]/, 'Password must contain at least one letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'New passwords do not match',
    path: ['confirmPassword'],
  });

// GET /api/profile
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    const totalOrders = await Order.countDocuments({ user: req.user._id });

    res.json({
      success: true,
      profile: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        avatarUrl: user.avatarUrl,
        phone: user.phone,
        fullName: user.fullName,
        address: user.address,
        createdAt: user.createdAt,
        totalOrders,
      },
    });
  })
);

// PATCH /api/profile
router.patch(
  '/',
  validate(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);

    if (req.body.fullName !== undefined) user.fullName = req.body.fullName;
    if (req.body.phone !== undefined) user.phone = req.body.phone;
    if (req.body.address !== undefined) user.address = req.body.address;
    if (req.body.avatarUrl !== undefined) user.avatarUrl = req.body.avatarUrl;

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully.',
      user,
    });
  })
);

// PATCH /api/profile/password
router.patch(
  '/password',
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id);

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Incorrect current password.', 400);
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully.',
    });
  })
);

module.exports = router;
