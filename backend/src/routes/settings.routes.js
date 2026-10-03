const express = require('express');
const Settings = require('../models/Settings');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/public',
  asyncHandler(async (req, res) => {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }

    res.json({
      success: true,
      settings: {
        storeName: settings.storeName,
        tagline: settings.tagline,
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        businessHours: settings.businessHours,
        deliveryFee: settings.deliveryFee,
        deliveryEnabled: settings.deliveryEnabled,
        pickupEnabled: settings.pickupEnabled,
        gcashEnabled: settings.gcashEnabled,
        codEnabled: settings.codEnabled,
        payAtShopEnabled: settings.payAtShopEnabled,
        gcashName: settings.gcashName,
        gcashNumber: settings.gcashNumber,
        acceptingOrders: settings.acceptingOrders,
        minimumOrder: settings.minimumOrder,
      },
    });
  })
);

module.exports = router;
