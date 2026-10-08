// Menu Page Controller with Robust Fallback
import { apiFetch } from './api.js';
import { renderHeader, renderFooter, showToast, escapeHtml } from './ui.js';
import { isLoggedIn } from './auth.js';
import { stockStream } from './stock-stream.js';
import {
  renderProductCard,
  setupAddToCartModal,
  attachProductGridListeners,
  setAvailableAddons,
  setOnlineOrderingEnabled,
} from './home.js';

export const ALL_MENU_PRODUCTS = [
  // Burgers
  {
    _id: 'prod-cdo-burger',
    name: 'CDO Burger',
    price: 27,
    category: { name: 'Burgers' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: true,
    slug: 'cdo-burger',
    description:
      'Classic grilled beef patty in a toasted sesame bun with our special dressing.',
  },
  {
    _id: 'prod-burger-ham',
    name: 'Burger with Ham',
    price: 36,
    category: { name: 'Burgers' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'burger-with-ham',
    description:
      'Juicy beef patty topped with sweet savory sliced ham and fresh dressing.',
  },
  {
    _id: 'prod-burger-egg',
    name: 'Burger with Egg',
    price: 38,
    category: { name: 'Burgers' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'burger-with-egg',
    description:
      'Grilled patty paired with a sunny fried egg and creamy shop sauce.',
  },
  {
    _id: 'prod-burger-bacon',
    name: 'Burger with Bacon',
    price: 42,
    category: { name: 'Burgers' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: true,
    slug: 'burger-with-bacon',
    description: 'Savory burger patty crowned with crispy smoked bacon strips.',
  },
  {
    _id: 'prod-burger-bacon-ham',
    name: 'Burger Bacon Ham',
    price: 52,
    category: { name: 'Burgers' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: true,
    slug: 'burger-bacon-ham',
    description:
      'The triple delight: beef patty, smoked bacon, and sweet ham loaded in a warm bun.',
  },

  // Cheese Burgers
  {
    _id: 'prod-cheese-burger',
    name: 'Cheese Burger',
    price: 35,
    category: { name: 'Cheese Burgers' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'cheese-burger',
    description:
      'Tender beef patty melted under a slice of rich cheddar cheese.',
  },
  {
    _id: 'prod-cheese-ham',
    name: 'Cheese Burger with Ham',
    price: 41,
    category: { name: 'Cheese Burgers' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'cheese-burger-with-ham',
    description: 'Cheddar cheese melted over a beef patty and savory ham.',
  },
  {
    _id: 'prod-cheese-egg',
    name: 'Cheese Burger with Egg',
    price: 43,
    category: { name: 'Cheese Burgers' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'cheese-burger-with-egg',
    description: 'Melted cheese burger topped with a perfectly cooked egg.',
  },
  {
    _id: 'prod-cheese-bacon',
    name: 'Cheese Burger with Bacon',
    price: 47,
    category: { name: 'Cheese Burgers' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: true,
    slug: 'cheese-burger-with-bacon',
    description:
      'Smokey crispy bacon layered over golden melted cheese and beef patty.',
  },

  // Sandwiches
  {
    _id: 'prod-ham',
    name: 'Ham',
    price: 29,
    category: { name: 'Sandwiches' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'ham',
    description:
      'Toasted sandwich layered with sweet sliced ham and house spread.',
  },
  {
    _id: 'prod-ham-cheese',
    name: 'Ham with Cheese',
    price: 36,
    category: { name: 'Sandwiches' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'ham-with-cheese',
    description: 'Classic ham toast with gooey melted American cheese.',
  },
  {
    _id: 'prod-ham-egg',
    name: 'Ham with Egg',
    price: 34,
    category: { name: 'Sandwiches' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'ham-with-egg',
    description: 'Warm ham toast with a fluffy sunny egg.',
  },
  {
    _id: 'prod-ham-cheese-egg',
    name: 'Ham Cheese with Egg',
    price: 48,
    category: { name: 'Sandwiches' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'ham-cheese-with-egg',
    description: 'Comforting trio of sliced ham, melted cheese, and fried egg.',
  },
  {
    _id: 'prod-egg-cheese',
    name: 'Egg Cheese',
    price: 38,
    category: { name: 'Sandwiches' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'egg-cheese',
    description:
      'Rich toasted sandwich filled with farm egg and melted cheddar.',
  },
  {
    _id: 'prod-egg-sandwich',
    name: 'Egg Sandwich',
    price: 30,
    category: { name: 'Sandwiches' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'egg-sandwich',
    description: 'Freshly fried egg in warm toasted bread with light mayo.',
  },
  {
    _id: 'prod-bacon-sandwich',
    name: 'Bacon Sandwich',
    price: 40,
    category: { name: 'Sandwiches' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'bacon-sandwich',
    description: 'Crisp smoked bacon strips between buttery toasted bread.',
  },
  {
    _id: 'prod-bacon-ham',
    name: 'Bacon with Ham',
    price: 49,
    category: { name: 'Sandwiches' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'bacon-with-ham',
    description: 'A savory pairing of crispy bacon and tender sweet ham.',
  },
  {
    _id: 'prod-bacon-egg',
    name: 'Bacon with Egg',
    price: 50,
    category: { name: 'Sandwiches' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'bacon-with-egg',
    description:
      'Hearty breakfast toast featuring crisp bacon and a fried egg.',
  },
  {
    _id: 'prod-bacon-cheese',
    name: 'Bacon with Cheese',
    price: 52,
    category: { name: 'Sandwiches' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'bacon-with-cheese',
    description: 'Smoked bacon strips smothered in rich melted cheddar.',
  },
  {
    _id: 'prod-bacon-cheese-ham',
    name: 'Bacon Cheese with Ham',
    price: 54,
    category: { name: 'Sandwiches' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'bacon-cheese-with-ham',
    description:
      'Crispy bacon, sliced ham, and melted cheese toasted golden brown.',
  },
  {
    _id: 'prod-bacon-cheese-egg',
    name: 'Bacon Cheese with Egg',
    price: 56,
    category: { name: 'Sandwiches' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'bacon-cheese-with-egg',
    description:
      'Deluxe sandwich loaded with crispy bacon, cheese, and fried egg.',
  },

  // Complete
  {
    _id: 'prod-complete',
    name: 'Complete',
    price: 70,
    category: { name: 'Complete' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: true,
    slug: 'complete',
    description:
      'All-in burger specialty loaded with patty, ham, egg, cheese, and fresh slaw.',
  },
  {
    _id: 'prod-complete-change-bacon',
    name: 'Complete Change Bacon',
    price: 65,
    category: { name: 'Complete' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'complete-change-bacon',
    description:
      'Complete specialty sandwich customized with bacon substitute for extra crunch.',
  },
  {
    _id: 'prod-complete-bacon',
    name: 'Complete with Bacon',
    price: 72,
    category: { name: 'Complete' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: true,
    slug: 'complete-with-bacon',
    description:
      'The ultimate monster burger: beef patty, ham, egg, cheese, slaw, and crispy bacon.',
  },

  // Footlong
  {
    _id: 'prod-footlong',
    name: 'Footlong',
    price: 47,
    category: { name: 'Footlong' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'footlong',
    description:
      'Classic footlong frankfurter in a toasted long roll with signature condiments.',
  },
  {
    _id: 'prod-footlong-ham',
    name: 'Footlong Ham',
    price: 53,
    category: { name: 'Footlong' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'footlong-ham',
    description: 'Footlong sausage layered with sweet cured ham slices.',
  },
  {
    _id: 'prod-footlong-egg',
    name: 'Footlong Egg',
    price: 58,
    category: { name: 'Footlong' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'footlong-egg',
    description: 'Footlong sausage sandwich topped with a fresh fried egg.',
  },
  {
    _id: 'prod-footlong-cheese',
    name: 'Footlong Cheese',
    price: 56,
    category: { name: 'Footlong' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'footlong-cheese',
    description:
      'Footlong roll loaded with sausage and smothered in melted cheese sauce.',
  },
  {
    _id: 'prod-footlong-bacon',
    name: 'Footlong Bacon',
    price: 64,
    category: { name: 'Footlong' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'footlong-bacon',
    description: 'Footlong sausage wrapped with crispy smoked bacon strips.',
  },
  {
    _id: 'prod-footlong-cheese-bacon',
    name: 'Footlong Cheese with Bacon',
    price: 77,
    category: { name: 'Footlong' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'footlong-cheese-with-bacon',
    description:
      'Footlong frank topped with rich melted cheese and crispy bacon crumble.',
  },
  {
    _id: 'prod-footlong-ham-bacon',
    name: 'Footlong Ham with Bacon',
    price: 77,
    category: { name: 'Footlong' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: 'footlong-ham-with-bacon',
    description:
      'Deluxe footlong roll piled high with ham and crisp smoked bacon.',
  },

  // Sides
  {
    _id: 'prod-siomai',
    name: '4pcs Grace Siomai',
    price: 20,
    category: { name: 'Sides' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: false,
    slug: '4pcs-grace-siomai',
    description:
      'Steamed pork siomai dumplings served with savory chili garlic and calamansi sauce.',
  },
];

let liveProducts = [...ALL_MENU_PRODUCTS];
let hasLiveProducts = false;
let activeCategory = 'all';
let searchQuery = '';
let currentSort = 'featured';

function getCategoryName(prod) {
  if (!prod.category) return '';
  if (typeof prod.category === 'string') return prod.category;
  return prod.category.name || '';
}

async function loadCategories() {
  const container = document.getElementById('category-chips');
  if (!container) return;

  try {
    const res = await apiFetch('/categories');
    const categories = res.categories || [];
    if (categories.length > 0) {
      const chipsHtml = [
        `<button class="chip ${activeCategory === 'all' ? 'active' : ''}" data-category="all">All Items</button>`,
        ...categories
          .filter((c) => c.name !== 'Add-ons')
          .map(
            (c) =>
              `<button class="chip ${activeCategory === c._id || activeCategory === c.name ? 'active' : ''}" data-category="${c._id}" data-name="${c.name}">${escapeHtml(c.name)}</button>`
          ),
      ].join('');

      container.innerHTML = chipsHtml;
    }
  } catch (err) {
    // Keep built-in chips
  }

  // Attach chip click listeners
  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      container
        .querySelectorAll('.chip')
        .forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      activeCategory = chip.getAttribute('data-category') || 'all';
      filterAndRenderProducts();
    });
  });
}

function filterAndRenderProducts() {
  const container = document.getElementById('menu-grid');
  if (!container) return;

  let filtered = [...liveProducts].filter((p) => !p.isAddon);

  // Category filter
  if (activeCategory && activeCategory !== 'all') {
    filtered = filtered.filter((p) => {
      const catName = getCategoryName(p);
      const catId = p.category && p.category._id ? p.category._id : '';
      return (
        catName.toLowerCase() === activeCategory.toLowerCase() ||
        catId === activeCategory
      );
    });
  }

  // Search filter
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q))
    );
  }

  // Sorting
  if (currentSort === 'price_asc') {
    filtered.sort((a, b) => a.price - b.price);
  } else if (currentSort === 'price_desc') {
    filtered.sort((a, b) => b.price - a.price);
  } else if (currentSort === 'name_asc') {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  } else if (currentSort === 'stock_desc') {
    filtered.sort((a, b) => b.stock - a.stock);
  } else if (currentSort === 'featured') {
    filtered.sort(
      (a, b) =>
        (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0) ||
        a.name.localeCompare(b.name)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="state-box" style="grid-column: 1 / -1;">
        <svg class="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        <h4 class="state-title">No items found</h4>
        <p class="state-desc">Try clearing your search query or selecting another category.</p>
        <button type="button" id="reset-filters-btn" class="btn btn-secondary btn-sm">Reset Filters</button>
      </div>
    `;
    const resetBtn = document.getElementById('reset-filters-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        activeCategory = 'all';
        searchQuery = '';
        const searchInput = document.getElementById('menu-search');
        if (searchInput) searchInput.value = '';
        const chips = document.querySelectorAll('.chip');
        chips.forEach((c) => c.classList.remove('active'));
        if (chips[0]) chips[0].classList.add('active');
        filterAndRenderProducts();
      });
    }
    return;
  }

  const isGuest = !isLoggedIn();
  container.innerHTML = filtered
    .map((p) => renderProductCard(p, isGuest, hasLiveProducts))
    .join('');
}

async function loadProducts() {
  // Render initial fallback immediately so menu is NEVER empty
  filterAndRenderProducts();

  try {
    const params = new URLSearchParams();
    if (activeCategory && activeCategory !== 'all')
      params.append('category', activeCategory);
    if (searchQuery.trim()) params.append('search', searchQuery.trim());
    if (currentSort) params.append('sort', currentSort);
    params.append('isAddon', 'false');

    const data = await apiFetch(`/products?${params.toString()}`);
    setAvailableAddons(data && data.addons);
    liveProducts = data && Array.isArray(data.products) ? data.products : [];
    hasLiveProducts = true;
    filterAndRenderProducts();
  } catch (err) {
    showToast(
      `Unable to load the live menu: ${err.message}. Sample items cannot be ordered until the connection returns.`,
      'error'
    );
  }
}

async function loadOrderingSettings() {
  const notice = document.getElementById('menu-ordering-notice');
  try {
    const res = await apiFetch('/settings/public');
    const onlineOrderingEnabled = Boolean(
      res.settings && res.settings.acceptingOrders
    );
    setOnlineOrderingEnabled(onlineOrderingEnabled);
    if (notice) {
      notice.classList.toggle('hidden', onlineOrderingEnabled);
      notice.textContent = onlineOrderingEnabled
        ? ''
        : 'Online ordering is temporarily paused. You can still browse the menu; please check back later.';
    }
  } catch (err) {
    setOnlineOrderingEnabled(false);
    if (notice) {
      notice.classList.remove('hidden');
      notice.textContent =
        'Online ordering availability could not be confirmed. Please try again later.';
    }
    showToast(
      `Unable to confirm online ordering availability: ${err.message}`,
      'error'
    );
  }
}

function initMenu() {
  renderHeader('menu');
  renderFooter();
  setupAddToCartModal();
  attachProductGridListeners('menu-grid', (id) =>
    liveProducts.find((p) => p._id === id)
  );
  loadCategories();
  loadOrderingSettings().then(loadProducts);
  stockStream.init();

  // Search input with debounce
  const searchInput = document.getElementById('menu-search');
  let searchTimeout = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchQuery = e.target.value;
        filterAndRenderProducts();
      }, 200);
    });
  }

  // Sort dropdown
  const sortSelect = document.getElementById('menu-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value;
      filterAndRenderProducts();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMenu);
} else {
  initMenu();
}
