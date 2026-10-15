const express = require('express');
const notificationRepository = require('../repositories/notificationRepository');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

const router = express.Router();
router.use(requireAuth);

// GET /api/notifications
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const isAdminScope = req.user.role === 'admin' && req.query.scope === 'admin';

    let notifications;
    let unreadCount;

    if (isAdminScope) {
      notifications = await notificationRepository.findForAdmin({ limit });
      unreadCount = await notificationRepository.getUnreadCount(null, true);
    } else {
      notifications = await notificationRepository.findByUser(req.user.id, {
        limit,
      });
      unreadCount = await notificationRepository.getUnreadCount(
        req.user.id,
        false
      );
    }

    res.json({
      success: true,
      notifications,
      unreadCount,
    });
  })
);

// PATCH /api/notifications/read-all
router.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    const isAdminScope = req.user.role === 'admin' && req.body.scope === 'admin';

    if (isAdminScope) {
      await notificationRepository.markAllAsRead(null, true);
    } else {
      await notificationRepository.markAllAsRead(req.user.id, false);
    }

    res.json({
      success: true,
      message: 'All notifications marked as read.',
    });
  })
);

// PATCH /api/notifications/:id/read
router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const isAdminScope = req.user.role === 'admin' && req.body.scope === 'admin';

    let notification;
    if (isAdminScope) {
      notification = await notificationRepository.markAsRead(
        req.params.id,
        null,
        true
      );
    } else {
      notification = await notificationRepository.markAsRead(
        req.params.id,
        req.user.id,
        false
      );
    }

    if (!notification) {
      throw new AppError('Notification not found.', 404);
    }

    res.json({
      success: true,
      notification,
    });
  })
);

module.exports = router;
