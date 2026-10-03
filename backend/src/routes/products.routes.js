const express = require('express');
const Product = require('../models/Product');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { category, search, sort, isAddon } = req.query;

    const query = {};

    if (category && category !== 'all') {
      query.category = category;
    }

    if (isAddon === 'true') {
      query.isAddon = true;
    } else if (isAddon === 'false') {
      query.isAddon = false;
    }

    if (search && search.trim()) {
      query.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    let sortObj = { isFeatured: -1, createdAt: -1 };
    if (sort === 'price_asc') {
      sortObj = { price: 1 };
    } else if (sort === 'price_desc') {
      sortObj = { price: -1 };
    } else if (sort === 'name_asc') {
      sortObj = { name: 1 };
    } else if (sort === 'stock_desc') {
      sortObj = { stock: -1 };
    } else if (sort === 'featured') {
      sortObj = { isFeatured: -1, name: 1 };
    }

    const products = await Product.find(query).populate('category').sort(sortObj);
    const addons = await Product.find({ isAddon: true, isAvailable: true }).sort({ price: 1 });

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
    const addons = await Product.find({ isAddon: true, isAvailable: true }).sort({ price: 1 });
    res.json({
      success: true,
      addons,
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id).populate('category');
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    res.json({ success: true, product });
  })
);

module.exports = router;
