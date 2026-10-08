const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const path = require('path');

const userRepository = require('../repositories/userRepository');
const orderRepository = require('../repositories/orderRepository');
const avatarRepository = require('../repositories/avatarRepository');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  AVATAR_MAX_BYTES,
  AVATAR_REQUEST_LIMIT,
  AVATAR_STORAGE_CAP_BYTES,
  acquireAvatarUserLock,
  deleteAvatarByUrl,
  getAvatarStorageUsage,
  releaseAvatarUserLock,
  releaseAvatarBytes,
  reserveAvatarBytes,
} = require('../services/avatarStorage');

const router = express.Router();

const AVATAR_MIME_TYPES = new Map([
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']],
  ['image/webp', ['.webp']],
]);

function parseAvatarMultipart(body, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(
    contentType || ''
  );
  const boundary =
    boundaryMatch && (boundaryMatch[1] || boundaryMatch[2]).trim();
  if (!boundary || boundary.length > 70 || !Buffer.isBuffer(body)) {
    throw new AppError('Please choose a valid JPG, PNG, or WebP photo.', 400);
  }

  const delimiter = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(delimiter);
  let photo = null;
  let partCount = 0;

  while (cursor !== -1) {
    cursor += delimiter.length;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) break;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n')))
      cursor += 2;

    const headersEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headersEnd === -1) {
      throw new AppError(
        'The photo upload could not be read. Please try again.',
        400
      );
    }

    const headers = body.subarray(cursor, headersEnd).toString('utf8');
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(
      headers
    );
    const nameMatch =
      disposition && /(?:^|;)\s*name="([^"]*)"/i.exec(disposition[1]);
    const filenameMatch =
      disposition && /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition[1]);
    const contentTypeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
    const dataStart = headersEnd + 4;
    const nextDelimiter = body.indexOf(
      Buffer.concat([Buffer.from('\r\n'), delimiter]),
      dataStart
    );

    if (nextDelimiter === -1) {
      throw new AppError(
        'The photo upload could not be read. Please try again.',
        400
      );
    }

    partCount += 1;
    if (nameMatch && nameMatch[1] === 'photo' && filenameMatch) {
      if (photo) throw new AppError('Upload one photo at a time.', 400);
      photo = {
        filename: path.basename(filenameMatch[1]),
        contentType: (contentTypeMatch ? contentTypeMatch[1] : '')
          .trim()
          .toLowerCase(),
        buffer: body.subarray(dataStart, nextDelimiter),
      };
    } else {
      throw new AppError(
        'Unexpected upload data. Please choose a photo and try again.',
        400
      );
    }

    cursor = nextDelimiter + 2;
  }

  if (partCount !== 1 || !photo || !photo.buffer.length) {
    throw new AppError('Please choose a photo to upload.', 400);
  }
  if (photo.buffer.length > AVATAR_MAX_BYTES) {
    throw new AppError('Photo must be 5 MiB or smaller.', 413);
  }

  const extension = path.extname(photo.filename).toLowerCase();
  const allowedExtensions = AVATAR_MIME_TYPES.get(photo.contentType);
  if (!allowedExtensions || !allowedExtensions.includes(extension)) {
    throw new AppError('Choose a JPG, PNG, or WebP photo.', 400);
  }

  const bytes = photo.buffer;
  const validSignature =
    photo.contentType === 'image/jpeg'
      ? bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      : photo.contentType === 'image/png'
        ? bytes.length >= 8 &&
          bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.length >= 12 &&
          bytes.toString('ascii', 0, 4) === 'RIFF' &&
          bytes.toString('ascii', 8, 12) === 'WEBP';

  if (!validSignature) {
    throw new AppError(
      'The selected file is not a valid JPG, PNG, or WebP image.',
      400
    );
  }

  return photo;
}

const avatarRateLimitHandler = (req, res, next) => {
  next(
    new AppError(
      'You have reached the photo upload limit. Please try again in an hour.',
      429
    )
  );
};

const unauthenticatedAvatarUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip)}`,
  skip: (req) => Boolean(req.get('authorization')),
  handler: avatarRateLimitHandler,
});

const avatarUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.user ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`,
  handler: avatarRateLimitHandler,
});

router.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/avatar') {
    return unauthenticatedAvatarUploadLimiter(req, res, next);
  }
  return next();
});
router.use(requireAuth);

const updateProfileSchema = z
  .object({
    firstName: z.string().trim().max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    contactEmail: z.string().trim().email().max(254).optional(),
    fullName: z.string().trim().max(121).optional(),
    phone: z
      .string()
      .trim()
      .max(20)
      .refine(
        (phone) =>
          !phone || /^(09\d{9}|\+639\d{9})$/.test(phone.replace(/[\s-]/g, '')),
        'Please provide a valid Philippine mobile number'
      )
      .optional(),
    street: z.string().trim().max(120).optional(),
    barangay: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    province: z.string().trim().max(100).optional(),
    postalCode: z
      .string()
      .trim()
      .refine(
        (postalCode) => !postalCode || /^\d{4}$/.test(postalCode),
        'Postal code must contain exactly 4 digits'
      )
      .optional(),
    address: z.string().trim().max(600).optional(),
    avatarUrl: z
      .string()
      .max(450000, 'Profile image size exceeds the 300KB limit')
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const addressFields = [
      'street',
      'barangay',
      'city',
      'province',
      'postalCode',
    ];
    if (
      addressFields.some(
        (field) => data[field] !== undefined && data[field] !== ''
      )
    ) {
      for (const field of addressFields) {
        if (!data[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: 'Complete every delivery address field.',
          });
        }
      }
    }
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
  .strict()
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'New passwords do not match',
    path: ['confirmPassword'],
  });

// GET /api/profile
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = await userRepository.findById(req.user.id);
    const totalOrders = await orderRepository.count({ userId: req.user.id });

    res.json({
      success: true,
      profile: {
        id: user.id,
        _id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        avatarUrl: user.avatarUrl,
        phone: user.phone,
        contactEmail: user.contactEmail || user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        street: user.street,
        barangay: user.barangay,
        city: user.city,
        province: user.province,
        postalCode: user.postalCode,
        address: user.address,
        createdAt: user.createdAt,
        totalOrders,
      },
    });
  })
);

// POST /api/profile/avatar - multipart/form-data field "photo"
router.post(
  '/avatar',
  avatarUploadLimiter,
  express.raw({ type: 'multipart/form-data', limit: AVATAR_REQUEST_LIMIT }),
  asyncHandler(async (req, res) => {
    const photo = parseAvatarMultipart(req.body, req.headers['content-type']);
    const lockToken = await acquireAvatarUserLock(req.user.id);
    let uploadedAvatar = null;
    let responseAvatarUrl = '';

    try {
      const user = await userRepository.findById(req.user.id);
      if (!user) throw new AppError('Your account could not be found.', 404);
      const previousAvatarUrl = user.avatarUrl;

      await reserveAvatarBytes(photo.buffer.length);

      uploadedAvatar = await avatarRepository.saveAvatar(req.user.id, {
        filename: photo.filename,
        contentType: photo.contentType,
        buffer: photo.buffer,
      });

      const uploadedAvatarUrl = `pgavatar:${uploadedAvatar.id}`;
      await userRepository.update(req.user.id, {
        avatarUrl: uploadedAvatarUrl,
      });

      await deleteAvatarByUrl(previousAvatarUrl);
      responseAvatarUrl = uploadedAvatarUrl;
    } catch (error) {
      if (uploadedAvatar) {
        await avatarRepository.deleteAvatar(uploadedAvatar.id);
      }
      throw error;
    } finally {
      await releaseAvatarUserLock(req.user.id, lockToken);
    }

    res.json({
      success: true,
      message: 'Profile photo updated successfully.',
      avatarUrl: responseAvatarUrl,
    });
  })
);

// Admin-only usage report
router.get(
  '/avatar/storage',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const usage = await getAvatarStorageUsage();
    res.json({
      success: true,
      usage: {
        ...usage,
        capBytes: AVATAR_STORAGE_CAP_BYTES,
        capMiB: AVATAR_STORAGE_CAP_BYTES / (1024 * 1024),
        usedPercent: Number(
          ((usage.usedBytes / AVATAR_STORAGE_CAP_BYTES) * 100).toFixed(2)
        ),
      },
    });
  })
);

// GET /api/profile/avatar
router.get(
  '/avatar',
  asyncHandler(async (req, res) => {
    const user = await userRepository.findById(req.user.id);
    if (!user || !user.avatarUrl) {
      throw new AppError('No profile photo is available.', 404);
    }

    let fileId = user.avatarUrl;
    if (user.avatarUrl.startsWith('pgavatar:')) {
      fileId = user.avatarUrl.slice('pgavatar:'.length);
    } else if (user.avatarUrl.startsWith('gridfs:')) {
      fileId = user.avatarUrl.slice('gridfs:'.length);
    }

    const avatar = await avatarRepository.getAvatar(fileId, req.user.id);
    if (!avatar) throw new AppError('Profile photo could not be found.', 404);

    res.setHeader(
      'Content-Type',
      AVATAR_MIME_TYPES.has(avatar.content_type)
        ? avatar.content_type
        : 'application/octet-stream'
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(avatar.data);
  })
);

// PATCH /api/profile
router.patch(
  '/',
  validate(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const user = await userRepository.findById(req.user.id);
    if (!user) throw new AppError('Account not found.', 404);

    const updates = {};
    if (req.body.firstName !== undefined)
      updates.firstName = req.body.firstName;
    if (req.body.lastName !== undefined) updates.lastName = req.body.lastName;
    if (req.body.firstName !== undefined || req.body.lastName !== undefined) {
      const fName =
        req.body.firstName !== undefined ? req.body.firstName : user.firstName;
      const lName =
        req.body.lastName !== undefined ? req.body.lastName : user.lastName;
      updates.fullName = [fName, lName].filter(Boolean).join(' ');
    } else if (req.body.fullName !== undefined) {
      updates.fullName = req.body.fullName;
    }

    if (req.body.contactEmail !== undefined)
      updates.contactEmail = req.body.contactEmail;
    if (req.body.phone !== undefined) updates.phone = req.body.phone;

    const addressFields = [
      'street',
      'barangay',
      'city',
      'province',
      'postalCode',
    ];
    const hasAddressValues = addressFields.some((field) => req.body[field]);
    if (hasAddressValues) {
      for (const field of addressFields) {
        if (req.body[field] !== undefined) updates[field] = req.body[field];
      }
    }
    if (req.body.address !== undefined) {
      updates.address = req.body.address;
    } else if (hasAddressValues) {
      const parts = addressFields
        .map((f) => (req.body[f] !== undefined ? req.body[f] : user[f]))
        .filter(Boolean);
      updates.address = parts.join(', ');
    }

    const previousAvatar = user.avatarUrl;
    if (req.body.avatarUrl !== undefined)
      updates.avatarUrl = req.body.avatarUrl;

    const updatedUser = await userRepository.update(req.user.id, updates);
    if (
      req.body.avatarUrl !== undefined &&
      req.body.avatarUrl !== previousAvatar
    ) {
      await deleteAvatarByUrl(previousAvatar);
    }

    res.json({
      success: true,
      message: 'Profile updated successfully.',
      user: userRepository.safeUser(updatedUser),
    });
  })
);

// PATCH /api/profile/password
router.patch(
  '/password',
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = await userRepository.findById(req.user.id);
    if (!user) throw new AppError('Account not found.', 404);

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Incorrect current password.', 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await userRepository.update(req.user.id, { passwordHash });

    res.json({
      success: true,
      message: 'Password changed successfully.',
    });
  })
);

module.exports = router;
