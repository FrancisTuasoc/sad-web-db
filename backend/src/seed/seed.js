const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  checkEnv,
} = require('../config/env');
const { connectDB, query, closeDB } = require('../config/db');
const userRepository = require('../repositories/userRepository');
const categoryRepository = require('../repositories/categoryRepository');
const productRepository = require('../repositories/productRepository');
const settingsRepository = require('../repositories/settingsRepository');

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function ensureAdminAndSettings() {
  const adminEmail = ADMIN_EMAIL.toLowerCase().trim();
  const adminPassword = ADMIN_PASSWORD;
  const adminUsername = ADMIN_USERNAME.trim();

  let admin = await userRepository.findByEmail(adminEmail);
  if (!admin) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    admin = await userRepository.create({
      username: adminUsername,
      email: adminEmail,
      passwordHash,
      role: 'admin',
      status: 'active',
      phone: '+63 912 345 6789',
      fullName: 'System Administrator',
      address: 'Shop Headquarters, Main Street',
    });
    console.log(`[SEED] Admin account created: ${adminEmail}`);
  }

  const settings = await settingsRepository.getSettings();
  console.log('[SEED] Store settings verified.');

  return { admin, settings };
}

const CATEGORIES_DATA = [
  { name: 'Burgers', sortOrder: 1 },
  { name: 'Cheese Burgers', sortOrder: 2 },
  { name: 'Sandwiches', sortOrder: 3 },
  { name: 'Complete', sortOrder: 4 },
  { name: 'Footlong', sortOrder: 5 },
  { name: 'Sides', sortOrder: 6 },
  { name: 'Add-ons', sortOrder: 7 },
];

const PRODUCTS_DATA = [
  // Burgers
  {
    category: 'Burgers',
    name: 'CDO Burger',
    price: 27,
    desc: 'Classic grilled beef patty in a toasted sesame bun with our special dressing.',
    featured: true,
  },
  {
    category: 'Burgers',
    name: 'Burger with Ham',
    price: 36,
    desc: 'Juicy beef patty topped with sweet savory sliced ham and fresh dressing.',
    featured: false,
  },
  {
    category: 'Burgers',
    name: 'Burger with Egg',
    price: 38,
    desc: 'Grilled patty paired with a sunny fried egg and creamy shop sauce.',
    featured: false,
  },
  {
    category: 'Burgers',
    name: 'Burger with Bacon',
    price: 42,
    desc: 'Savory burger patty crowned with crispy smoked bacon strips.',
    featured: true,
  },
  {
    category: 'Burgers',
    name: 'Burger Bacon Ham',
    price: 52,
    desc: 'The triple delight: beef patty, smoked bacon, and sweet ham loaded in a warm bun.',
    featured: true,
  },

  // Cheese Burgers
  {
    category: 'Cheese Burgers',
    name: 'Cheese Burger',
    price: 35,
    desc: 'Tender beef patty melted under a slice of rich cheddar cheese.',
    featured: false,
  },
  {
    category: 'Cheese Burgers',
    name: 'Cheese Burger with Ham',
    price: 41,
    desc: 'Cheddar cheese melted over a beef patty and savory ham.',
    featured: false,
  },
  {
    category: 'Cheese Burgers',
    name: 'Cheese Burger with Egg',
    price: 43,
    desc: 'Melted cheese burger topped with a perfectly cooked egg.',
    featured: false,
  },
  {
    category: 'Cheese Burgers',
    name: 'Cheese Burger with Bacon',
    price: 47,
    desc: 'Smokey crispy bacon layered over golden melted cheese and beef patty.',
    featured: true,
  },

  // Sandwiches
  {
    category: 'Sandwiches',
    name: 'Ham',
    price: 29,
    desc: 'Toasted sandwich layered with sweet sliced ham and house spread.',
    featured: false,
  },
  {
    category: 'Sandwiches',
    name: 'Ham with Cheese',
    price: 36,
    desc: 'Classic ham toast with gooey melted American cheese.',
    featured: false,
  },
  {
    category: 'Sandwiches',
    name: 'Ham with Egg',
    price: 34,
    desc: 'Warm ham toast with a fluffy sunny egg.',
    featured: false,
  },
  {
    category: 'Sandwiches',
    name: 'Ham Cheese with Egg',
    price: 48,
    desc: 'Comforting trio of sliced ham, melted cheese, and fried egg.',
    featured: false,
  },
  {
    category: 'Sandwiches',
    name: 'Egg Cheese',
    price: 38,
    desc: 'Rich toasted sandwich filled with farm egg and melted cheddar.',
    featured: false,
  },
  {
    category: 'Sandwiches',
    name: 'Egg Sandwich',
    price: 30,
    desc: 'Freshly fried egg in warm toasted bread with light mayo.',
    featured: false,
  },
  {
    category: 'Sandwiches',
    name: 'Bacon Sandwich',
    price: 40,
    desc: 'Crisp smoked bacon strips between buttery toasted bread.',
    featured: false,
  },
  {
    category: 'Sandwiches',
    name: 'Bacon with Ham',
    price: 49,
    desc: 'A savory pairing of crispy bacon and tender sweet ham.',
    featured: false,
  },
  {
    category: 'Sandwiches',
    name: 'Bacon with Egg',
    price: 50,
    desc: 'Hearty breakfast toast featuring crisp bacon and a fried egg.',
    featured: false,
  },
  {
    category: 'Sandwiches',
    name: 'Bacon with Cheese',
    price: 52,
    desc: 'Smoked bacon strips smothered in rich melted cheddar.',
    featured: false,
  },
  {
    category: 'Sandwiches',
    name: 'Bacon Cheese with Ham',
    price: 54,
    desc: 'Crispy bacon, sliced ham, and melted cheese toasted golden brown.',
    featured: false,
  },
  {
    category: 'Sandwiches',
    name: 'Bacon Cheese with Egg',
    price: 56,
    desc: 'Deluxe sandwich loaded with crispy bacon, cheese, and fried egg.',
    featured: false,
  },

  // Complete
  {
    category: 'Complete',
    name: 'Complete',
    price: 70,
    desc: 'All-in burger specialty loaded with patty, ham, egg, cheese, and fresh slaw.',
    featured: true,
  },
  {
    category: 'Complete',
    name: 'Complete Change Bacon',
    price: 65,
    desc: 'Complete specialty sandwich customized with bacon substitute for extra crunch.',
    featured: false,
  },
  {
    category: 'Complete',
    name: 'Complete with Bacon',
    price: 72,
    desc: 'The ultimate monster burger: beef patty, ham, egg, cheese, slaw, and crispy bacon.',
    featured: true,
  },

  // Footlong
  {
    category: 'Footlong',
    name: 'Footlong',
    price: 47,
    desc: 'Classic footlong frankfurter in a toasted long roll with signature condiments.',
    featured: false,
  },
  {
    category: 'Footlong',
    name: 'Footlong Ham',
    price: 53,
    desc: 'Footlong sausage layered with sweet cured ham slices.',
    featured: false,
  },
  {
    category: 'Footlong',
    name: 'Footlong Egg',
    price: 58,
    desc: 'Footlong sausage sandwich topped with a fresh fried egg.',
    featured: false,
  },
  {
    category: 'Footlong',
    name: 'Footlong Cheese',
    price: 56,
    desc: 'Footlong roll loaded with sausage and smothered in melted cheese sauce.',
    featured: false,
  },
  {
    category: 'Footlong',
    name: 'Footlong Bacon',
    price: 64,
    desc: 'Footlong sausage wrapped with crispy smoked bacon strips.',
    featured: false,
  },
  {
    category: 'Footlong',
    name: 'Footlong Cheese with Bacon',
    price: 77,
    desc: 'Footlong frank topped with rich melted cheese and crispy bacon crumble.',
    featured: false,
  },
  {
    category: 'Footlong',
    name: 'Footlong Ham with Bacon',
    price: 77,
    desc: 'Deluxe footlong roll piled high with ham and crisp smoked bacon.',
    featured: false,
  },

  // Sides
  {
    category: 'Sides',
    name: '4pcs Grace Siomai',
    price: 20,
    desc: 'Steamed pork siomai dumplings served with savory chili garlic and calamansi sauce.',
    featured: false,
  },

  // Add-ons
  {
    category: 'Add-ons',
    name: 'Add Patty',
    price: 15,
    desc: 'Extra beef patty grilled to perfection.',
    isAddon: true,
  },
  {
    category: 'Add-ons',
    name: 'Add Ham',
    price: 12,
    desc: 'Extra slice of sweet savory ham.',
    isAddon: true,
  },
  {
    category: 'Add-ons',
    name: 'Add Coleslaw',
    price: 3,
    desc: 'Crisp shredded cabbage in tangy sweet dressing.',
    isAddon: true,
  },
];

async function seedAll() {
  checkEnv();

  await connectDB();
  console.log('Connected to PostgreSQL for seeding...');

  // 1. Ensure Schema
  const schemaSql = fs.readFileSync(
    path.join(__dirname, '../db/schema.sql'),
    'utf8'
  );
  await query(schemaSql);
  console.log('[SEED] Database schema applied successfully.');

  // 2. Admin and Settings
  await ensureAdminAndSettings();

  // 3. Categories
  const categoryMap = new Map();
  for (const cat of CATEGORIES_DATA) {
    const res = await query(
      `INSERT INTO categories (name, sort_order)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order
       RETURNING id, name`,
      [cat.name, cat.sortOrder]
    );
    categoryMap.set(cat.name, res.rows[0].id);
  }
  console.log(`[SEED] Upserted ${categoryMap.size} categories.`);

  // 4. Products
  let productCount = 0;
  for (const prod of PRODUCTS_DATA) {
    const catId = categoryMap.get(prod.category);
    const slug = slugify(prod.name);
    const isAddon = Boolean(prod.isAddon);
    const defaultStock = isAddon ? 100 : 40;
    const imagePath = `assets/items/${slug}.png`;

    await query(
      `INSERT INTO products (
        name, slug, description, price, stock, low_stock_threshold,
        category_id, image, is_addon, is_available, is_featured
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        price = EXCLUDED.price,
        category_id = EXCLUDED.category_id,
        image = EXCLUDED.image,
        is_addon = EXCLUDED.is_addon,
        is_featured = EXCLUDED.is_featured,
        updated_at = CURRENT_TIMESTAMP`,
      [
        prod.name,
        slug,
        prod.desc,
        prod.price,
        defaultStock,
        10,
        catId,
        imagePath,
        isAddon,
        true,
        Boolean(prod.featured),
      ]
    );
    productCount++;
  }
  console.log(`[SEED] Upserted ${productCount} products.`);

  console.log('\n[SEED] Database seeding complete!\n');
  await closeDB();
}

if (require.main === module) {
  seedAll().catch((err) => {
    console.error('[SEED ERROR]', err.message);
    process.exit(1);
  });
}

module.exports = {
  ensureAdminAndSettings,
  seedAll,
};
