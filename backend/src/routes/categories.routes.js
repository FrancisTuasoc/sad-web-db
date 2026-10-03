const express = require('express');
const Category = require('../models/Category');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const categories = await Category.find().sort({ sortOrder: 1, name: 1 });
    res.json({
      success: true,
      categories,
    });
  })
);

module.exports = router;
