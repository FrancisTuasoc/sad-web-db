const express = require('express');
const settingsRepository = require('../repositories/settingsRepository');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/public',
  asyncHandler(async (req, res) => {
    const settings = await settingsRepository.getSettings();

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
