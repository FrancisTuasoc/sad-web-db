const express = require('express');
const categoryRepository = require('../repositories/categoryRepository');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const categories = await categoryRepository.findAll();
    res.json({
      success: true,
      categories,
    });
  })
);

module.exports = router;
