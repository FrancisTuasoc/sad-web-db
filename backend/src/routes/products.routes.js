const express = require('express');
const productRepository = require('../repositories/productRepository');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { category, search, sort, isAddon } = req.query;

    const filter = {
      category,
      search,
      sort,
    };

    if (isAddon === 'true') {
      filter.isAddon = true;
    } else if (isAddon === 'false') {
      filter.isAddon = false;
    }

    const products = await productRepository.find(filter);
    const addons = await productRepository.find({
      isAddon: true,
      isAvailable: true,
      sort: 'price_asc',
    });

    res.json({
      success: true,
      count: products.length,
      products,
      addons,
    });
  })
);

router.get(
  '/addons',
  asyncHandler(async (req, res) => {
    const addons = await productRepository.find({
      isAddon: true,
      isAvailable: true,
      sort: 'price_asc',
    });
    res.json({
      success: true,
      addons,
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await productRepository.findById(req.params.id);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: 'Product not found' });
    }
    res.json({ success: true, product });
  })
);

module.exports = router;
