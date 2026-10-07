// Real-time Stock Stream Client (SSE with auto-reconnect and polling fallback)

import { apiFetch, apiUrl } from './api.js';

class StockStream {
  constructor() {
    this.source = null;
    this.pollingTimer = null;
    this.listeners = new Set();
    this.usePolling = false;
  }

  init() {
    this.connectSSE();
  }

  connectSSE() {
    if (typeof EventSource === 'undefined') {
      this.startPolling();
      return;
    }

    try {
      this.source = new EventSource(apiUrl('/stream'));

      this.source.addEventListener('stock', (event) => {
        try {
          const data = JSON.parse(event.data);
          this.notify(data);
          this.updateDOMStock(data.productId, data.stock, data.isAvailable);
        } catch (e) {
          // ignore parsing error
        }
      });

      this.source.onopen = () => {
        if (this.pollingTimer) {
          clearInterval(this.pollingTimer);
          this.pollingTimer = null;
        }
      };

      this.source.onerror = () => {
        if (this.source) {
          this.source.close();
          this.source = null;
        }
        // Fallback to polling if SSE encounters an error
        this.startPolling();
        // Try reconnecting SSE in 15 seconds
        setTimeout(() => {
          if (!this.source) {
            this.connectSSE();
          }
        }, 15000);
      };
    } catch (e) {
      this.startPolling();
    }
  }

  startPolling() {
    if (this.pollingTimer) return;
    this.pollStock();
    this.pollingTimer = setInterval(() => {
      this.pollStock();
    }, 10000); // 10s fallback polling
  }

  async pollStock() {
    try {
      const data = await apiFetch('/products');
      if (data && data.products) {
        for (const item of data.products) {
          this.notify({
            productId: item._id,
            stock: item.stock,
            isAvailable: item.isAvailable,
          });
          this.updateDOMStock(item._id, item.stock, item.isAvailable);
        }
      }
    } catch (err) {
      // ignore network errors during poll
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify(stockData) {
    for (const listener of this.listeners) {
      try {
        listener(stockData);
      } catch (e) {
        console.error(e);
      }
    }
  }

  updateDOMStock(productId, stock, isAvailable) {
    const cards = document.querySelectorAll(`[data-product-id="${productId}"]`);
    cards.forEach((card) => {
      const badge = card.querySelector('.stock-badge');
      const addBtn = card.querySelector('.btn-add-to-cart');
      card.setAttribute('data-stock', stock);
      card.setAttribute('data-available', String(isAvailable));

      const orderingAllowed = card.getAttribute('data-ordering-allowed') === 'true';
      if (!isAvailable) {
        card.classList.add('unavailable');
        if (badge) {
          badge.className = 'badge badge-out-stock stock-badge';
          badge.textContent = 'Not Available';
        }
      } else if (stock <= 0) {
        card.classList.add('unavailable');
        if (badge) {
          badge.className = 'badge badge-out-stock stock-badge';
          badge.textContent = 'Out of Stock';
        }
      } else {
        card.classList.remove('unavailable');
        const threshold = parseInt(card.getAttribute('data-threshold') || '10', 10);
        if (badge) {
          if (stock <= threshold) {
            badge.className = 'badge badge-low-stock stock-badge';
            badge.textContent = `Only ${stock} left`;
          } else {
            badge.className = 'badge badge-in-stock stock-badge';
            badge.textContent = `${stock} left`;
          }
        }
      }

      if (addBtn) {
        if (!orderingAllowed) {
          addBtn.disabled = true;
          addBtn.textContent = 'Ordering Paused';
        } else if (!isAvailable) {
          addBtn.disabled = true;
          addBtn.textContent = 'Unavailable';
        } else if (stock <= 0) {
          addBtn.disabled = true;
          addBtn.textContent = 'Out of Stock';
        } else {
          addBtn.disabled = false;
          addBtn.textContent = addBtn.getAttribute('data-is-guest') === 'true'
            ? 'Login to order'
            : 'Add to Cart';
        }
      }
    });
  }
}

export const stockStream = new StockStream();
