const express = require('express');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const checkoutSchema = require('../utils/checkoutValidation');
const { requireAuth } = require('../middleware/auth');
const { placeOrder, cancelOrder, completeOrder } = require('../services/order.service');

const router = express.Router();
router.use(requireAuth);

// POST /api/orders
router.post(
  '/',
  validate(checkoutSchema),
  asyncHandler(async (req, res) => {
    const { cartItemIds, fulfillment, paymentMethod, gcashReference } = req.body;
    const contact = {
      ...req.body.contact,
      email: req.body.contact.email || req.user.email,
    };

    const order = await placeOrder({
      userId: req.user._id,
      cartItemIds,
      fulfillment,
      paymentMethod,
      gcashReference,
      contact,
    });

    res.status(201).json({
      success: true,
      message: 'Order placed successfully!',
      order,
    });
  })
);

// GET /api/orders/mine
router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const { status, limit = 50 } = req.query;
    const filter = { user: req.user._id };

    if (status) {
      if (status === 'active') {
        filter.status = { $in: ['pending', 'preparing', 'ready_for_pickup', 'ready_to_deliver', 'to_pickup', 'to_ship'] };
      } else if (status === 'history') {
        filter.status = { $in: ['completed', 'cancelled'] };
      } else {
        filter.status = status;
      }
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    res.json({
      success: true,
      orders,
    });
  })
);

// GET /api/orders/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const query = { _id: req.params.id };
    if (req.user.role !== 'admin') {
      query.user = req.user._id;
    }

    const order = await Order.findOne(query);
    if (!order) {
      throw new AppError('Order not found.', 404);
    }

    res.json({
      success: true,
      order,
    });
  })
);

// PATCH /api/orders/:id/cancel
router.patch(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const order = await cancelOrder(req.params.id, req.user, req.user.role);

    res.json({
      success: true,
      message: 'Order has been successfully cancelled.',
      order,
    });
  })
);

router.patch(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const order = await completeOrder(req.params.id, req.user._id);
    res.json({
      success: true,
      message: 'Order marked as completed.',
      order,
    });
  })
);

module.exports = router;
