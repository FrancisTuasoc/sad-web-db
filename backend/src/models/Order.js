const mongoose = require('mongoose');

const orderItemAddonSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },
    name: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    qty: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
  },
  { _id: false }
);

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },
    name: {
      type: String,
      required: true,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    addons: {
      type: [orderItemAddonSchema],
      default: [],
    },
    addonQuantityMode: {
      type: String,
      enum: ['per_item', 'per_order'],
      default: 'per_item',
    },
    lineTotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
    },
    at: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: [(val) => val.length > 0, 'Order must contain at least one item'],
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    deliveryFee: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    fulfillment: {
      type: String,
      enum: ['pickup', 'delivery'],
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: ['gcash', 'pay_at_shop', 'cod'],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid'],
      default: 'unpaid',
    },
    gcashReference: {
      type: String,
      default: '',
    },
    contact: {
      fullName: { type: String, required: true },
      firstName: { type: String, default: '' },
      lastName: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, required: true },
      street: { type: String, default: '' },
      barangay: { type: String, default: '' },
      city: { type: String, default: '' },
      province: { type: String, default: '' },
      postalCode: {
        type: String,
        default: '',
        validate: {
          validator: (postalCode) => !postalCode || /^\d{4}$/.test(postalCode),
          message: 'Postal code must contain exactly 4 digits',
        },
      },
      address: { type: String, default: '' },
    },
    status: {
      type: String,
      enum: ['pending', 'ready_for_pickup', 'ready_to_deliver', 'completed', 'cancelled', 'to_pickup', 'to_ship'],
      default: 'pending',
      index: true,
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: () => [{ status: 'pending', at: new Date() }],
    },
    cancelledBy: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
