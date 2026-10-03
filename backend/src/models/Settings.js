const mongoose = require('mongoose');

const dayHoursSchema = new mongoose.Schema(
  {
    open: { type: String, default: '09:00' },
    close: { type: String, default: '21:00' },
    closed: { type: Boolean, default: false },
  },
  { _id: false }
);

const settingsSchema = new mongoose.Schema(
  {
    storeName: {
      type: String,
      default: 'Burger Shop',
      trim: true,
    },
    tagline: {
      type: String,
      default: 'Flavor on Wheels - Freshly Grilled Everyday',
      trim: true,
    },
    address: {
      type: String,
      default: '123 Main Street, City Center',
      trim: true,
    },
    phone: {
      type: String,
      default: '+63 912 345 6789',
      trim: true,
    },
    email: {
      type: String,
      default: 'hello@burgershop.com',
      trim: true,
    },
    businessHours: {
      monday: { type: dayHoursSchema, default: () => ({ open: '09:00', close: '21:00', closed: false }) },
      tuesday: { type: dayHoursSchema, default: () => ({ open: '09:00', close: '21:00', closed: false }) },
      wednesday: { type: dayHoursSchema, default: () => ({ open: '09:00', close: '21:00', closed: false }) },
      thursday: { type: dayHoursSchema, default: () => ({ open: '09:00', close: '21:00', closed: false }) },
      friday: { type: dayHoursSchema, default: () => ({ open: '09:00', close: '22:00', closed: false }) },
      saturday: { type: dayHoursSchema, default: () => ({ open: '09:00', close: '22:00', closed: false }) },
      sunday: { type: dayHoursSchema, default: () => ({ open: '10:00', close: '20:00', closed: false }) },
    },
    deliveryFee: {
      type: Number,
      default: 30,
      min: 0,
    },
    deliveryEnabled: {
      type: Boolean,
      default: true,
    },
    pickupEnabled: {
      type: Boolean,
      default: true,
    },
    gcashEnabled: {
      type: Boolean,
      default: true,
    },
    codEnabled: {
      type: Boolean,
      default: true,
    },
    payAtShopEnabled: {
      type: Boolean,
      default: true,
    },
    gcashName: {
      type: String,
      default: 'Burger Shop HQ',
      trim: true,
    },
    gcashNumber: {
      type: String,
      default: '09171234567',
      trim: true,
    },
    acceptingOrders: {
      type: Boolean,
      default: true,
    },
    minimumOrder: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Settings', settingsSchema);
