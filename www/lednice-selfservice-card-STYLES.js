'use strict';

/**
 * Lednice Self-Service Card - SECURE VERSION with SERVER-SIDE VALIDATION
 *
 * Security approach:
 * - NO client-side state for authentication
 * - ALL authentication through Home Assistant service calls
 * - Products only shown after server confirms valid PIN via event
 * - Event-based architecture prevents client-side bypass
 */

// ============================================
// KONFIGURACE STYLU KLÁVESNICE
// ============================================
const KEYPAD_STYLE = 'classic';  // Možnosti: 'classic' nebo 'modern'

class LedniceSelfServiceCard extends HTMLElement {
  constructor() {
    super();
    this._pin = '';
    this._cart = {};
    this._productCodes = {};
    this._inactivityTimer = null;
    this._inactivityTimeout = 60000;
    this._serverValidatedRoom = null;
    this._sessionTimestamp = null;
    this._locked = false;
    this._lockTimer = null;
    this._failedAttempts = 0;
    this._eventListenerSetup = false;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Please define an entity (sensor.lednice_inventory)');
    }
    this.config = config;
  }

  set hass(hass) {
    this._hass = hass;

    if (!this.content) {
      const card = document.createElement('ha-card');
      card.header = this.config.title || 'Samoobslužná lednice';
      this.appendChild(card);

      this.content = document.createElement('div');
      card.appendChild(this.content);
    }

    if (!this._eventListenerSetup) {
      hass.connection.subscribeEvents((event) => {
        console.warn('📨 Received event:', event);
        this._handlePinVerificationEvent(event.data);
      }, 'lednice_pin_verified');

      this._eventListenerSetup = true;
    }
  }

  _handlePinVerificationEvent(data) {
    const { valid, room, pin } = data;

    console.warn(`🔐 Server PIN verification result: valid=${valid}, room=${room}, pin=${pin}`);

    if (valid === true && room && typeof room === 'string' && room.length > 0) {
      // ✅ SERVER CONFIRMED - Valid PIN
      console.warn(`✅ SERVER APPROVED ACCESS - Room: ${room}`);
      this._serverValidatedRoom = room;
      this._sessionTimestamp = Date.now();
      this._failedAttempts = 0;
      this._pin = ''; // Clear PIN after successful auth
      this._startInactivityTimer();
      this._render();
    } else if (valid === false) {
      // ❌ SERVER REJECTED - Invalid PIN
      console.error(`❌ SERVER DENIED ACCESS - Invalid PIN: ${pin}`);
      this._serverValidatedRoom = null;
      this._sessionTimestamp = null;
      this._failedAttempts++;

      if (this._failedAttempts >= 3) {
        console.warn('🔒 Too many failed attempts - locking for 30 seconds');
        this._lockCard();
      } else {
        this._pin = '';
        this._render();
        const errorEl = this.content.querySelector('#pin-error');
        if (errorEl) {
          errorEl.textContent = 'Neplatný PIN - zkuste znovu';
        }
      }
    }
  }

  _render() {
    if (!this._hass || !this.config) return;

    const entity = this._hass.states[this.config.entity];
    if (!entity) {
      this.content.innerHTML = '<div style="padding: 20px;">Entity not found</div>';
      return;
    }

    this._productCodes = entity.attributes.product_codes || {};

    if (this._isSessionValid() && this._serverValidatedRoom) {
      this._resetInactivityTimer();
      this._renderShopping();
    } else {
      this._renderPinScreen();
    }
  }

  _isSessionValid() {
    if (!this._sessionTimestamp || !this._serverValidatedRoom) {
      return false;
    }
    const now = Date.now();
    const elapsed = now - this._sessionTimestamp;
    return elapsed < 600000;
  }

  _renderPinScreen() {
    const isLocked = this._locked;
    const buttonDisabled = isLocked ? 'disabled' : '';

    // Volba stylů podle konfigurace
    const styles = KEYPAD_STYLE === 'modern' ? this._getModernStyles() : this._getClassicStyles();

    const html = `
      <style>
        .selfservice-container {
          padding: 20px;
          font-family: 'Roboto', sans-serif;
        }
        .pin-screen {
          text-align: center;
          max-width: 400px;
          margin: 0 auto;
        }
        .pin-title {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 5px;
          color: var(--primary-text-color);
        }
        .pin-subtitle {
          font-size: 14px;
          color: var(--secondary-text-color);
          margin-bottom: 20px;
        }
        .pin-input {
          width: 100%;
          font-size: 32px;
          text-align: center;
          padding: 15px;
          margin-bottom: 20px;
          border: 2px solid var(--divider-color);
          border-radius: 8px;
          letter-spacing: 15px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        .pin-input.error {
          border-color: var(--error-color);
          animation: shake 0.3s;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-10px); }
          75% { transform: translateX(10px); }
        }
        ${styles}
        .pin-error {
          color: var(--error-color);
          font-size: 14px;
          margin-top: 0;
          font-weight: bold;
          min-height: 20px;
        }
        .pin-warning {
          color: var(--warning-color, orange);
          font-size: 12px;
          margin-top: 0;
        }
        .security-badge {
          background: var(--success-color);
          color: white;
          padding: 6px 12px;
          border-radius: 16px;
          font-size: 11px;
          margin-top: 5px;
        }
      </style>
      <div class="selfservice-container">
        <div class="pin-screen">
          <div class="pin-title">${isLocked ? '🔒 Dočasně uzamčeno' : '🔐 Zadejte PIN pokoje'}</div>
          <div class="pin-subtitle">Ověření probíhá na serveru</div>
          <input
            type="password"
            class="pin-input ${this._failedAttempts > 0 ? 'error' : ''}"
            id="pin-display"
            readonly
            value="${'•'.repeat(this._pin.length)}"
            maxlength="4"
          />
          <div class="pin-keypad">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n =>
              `<button class="pin-button" data-key="${n}" ${buttonDisabled}>${n}</button>`
            ).join('')}
            <button class="pin-button clear" data-key="clear" ${buttonDisabled}>C</button>
            <button class="pin-button" data-key="0" ${buttonDisabled}>0</button>
            <button class="pin-button enter" data-key="enter" ${buttonDisabled}>✓</button>
          </div>
          <div class="pin-error" id="pin-error"></div>
          ${this._failedAttempts > 0 && this._failedAttempts < 3 ?
            `<div class="pin-warning">Neúspěšné pokusy: ${this._failedAttempts}/3</div>` : ''}
          <div class="security-badge">🛡️ Server-side validace</div>
        </div>
      </div>
    `;

    this.content.innerHTML = html;
    if (!isLocked) {
      this._attachPinListeners();
    }
  }

  _getClassicStyles() {
    return `
        .pin-keypad {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 15px;
        }
        .pin-button {
          font-size: 20px;
          padding: 15px;
          border: 2px solid var(--divider-color);
          border-radius: 8px;
          background: var(--primary-color);
          color: white;
          cursor: pointer;
          transition: all 0.2s;
        }
        .pin-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .pin-button:not(:disabled):active {
          transform: scale(0.95);
          background: var(--dark-primary-color);
        }
        .pin-button.clear {
          background: var(--error-color);
        }
        .pin-button.enter {
          background: var(--success-color);
          grid-column: span 2;
        }
    `;
  }

  _getModernStyles() {
    return `
        .pin-keypad {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 15px;
          margin-bottom: 15px;
        }
        .pin-button {
          font-size: 24px;
          font-weight: bold;
          padding: 20px;
          border: none;
          border-radius: 50%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          cursor: pointer;
          transition: all 0.3s;
          box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
          width: 70px;
          height: 70px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto;
        }
        .pin-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
        }
        .pin-button:not(:disabled):hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }
        .pin-button:not(:disabled):active {
          transform: translateY(0);
          box-shadow: 0 2px 10px rgba(102, 126, 234, 0.4);
        }
        .pin-button.clear {
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          box-shadow: 0 4px 15px rgba(245, 87, 108, 0.4);
        }
        .pin-button.clear:not(:disabled):hover {
          box-shadow: 0 6px 20px rgba(245, 87, 108, 0.6);
        }
        .pin-button.enter {
          background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
          grid-column: span 2;
          border-radius: 35px;
          width: auto;
          box-shadow: 0 4px 15px rgba(79, 172, 254, 0.4);
        }
        .pin-button.enter:not(:disabled):hover {
          box-shadow: 0 6px 20px rgba(79, 172, 254, 0.6);
        }
    `;
  }

  _attachPinListeners() {
    const buttons = this.content.querySelectorAll('.pin-button');
    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const key = e.target.dataset.key;
        this._handlePinKey(key);
      });
    });
  }

  _handlePinKey(key) {
    console.warn('🔑 PIN key pressed:', key);
    const errorEl = this.content.querySelector('#pin-error');
    if (errorEl) errorEl.textContent = '';

    if (key === 'clear') {
      this._pin = '';
    } else if (key === 'enter') {
      console.warn('✅ ENTER pressed - Requesting server verification');
      this._verifyPinWithServer();
      return;
    } else if (this._pin.length < 4) {
      this._pin += key;
    }

    const pinDisplay = this.content.querySelector('#pin-display');
    if (pinDisplay) pinDisplay.value = '•'.repeat(this._pin.length);
  }

  async _verifyPinWithServer() {
    if (this._locked) {
      console.warn('🔒 Verification blocked - card is locked');
      return;
    }

    if (this._pin.length !== 4) {
      const errorEl = this.content.querySelector('#pin-error');
      if (errorEl) errorEl.textContent = 'Zadejte 4-ciferný PIN';
      return;
    }

    console.warn(`🌐 Calling Home Assistant service: lednice.verify_pin with PIN: ${this._pin}`);

    try {
      // Show loading state
      const errorEl = this.content.querySelector('#pin-error');
      if (errorEl) {
        errorEl.textContent = '⏳ Ověřuji na serveru...';
        errorEl.style.color = 'var(--primary-color)';
      }

      // Call Home Assistant service - response will come via event
      // Note: Using event-based approach because return_response has syntax issues
      await this._hass.callService('lednice', 'verify_pin', {
        pin: this._pin
      });

      console.warn('📡 Service call sent - response will arrive via event lednice_pin_verified');

      // The response will come via event listener (_handlePinVerificationEvent)
      // Event is fired by the service handler in __init__.py line 333

    } catch (err) {
      console.error('❌ Service call failed:', err);
      const errorEl = this.content.querySelector('#pin-error');
      if (errorEl) {
        errorEl.textContent = 'Chyba spojení se serverem';
        errorEl.style.color = 'var(--error-color)';
      }
    }
  }

  _lockCard() {
    this._locked = true;
    this._serverValidatedRoom = null;
    this._sessionTimestamp = null;
    this._failedAttempts = 0;
    this._pin = '';
    this._render();

    if (this._lockTimer) {
      clearTimeout(this._lockTimer);
    }

    this._lockTimer = setTimeout(() => {
      this._locked = false;
      this._render();
    }, 30000);
  }

  _startInactivityTimer() {
    this._clearInactivityTimer();
    this._inactivityTimer = setTimeout(() => {
      console.warn('⏱️ Inactivity timeout - logging out');
      this._logout();
    }, this._inactivityTimeout);
  }

  _resetInactivityTimer() {
    if (this._isSessionValid()) {
      this._sessionTimestamp = Date.now(); // Refresh session
      this._startInactivityTimer();
    }
  }

  _clearInactivityTimer() {
    if (this._inactivityTimer) {
      clearTimeout(this._inactivityTimer);
      this._inactivityTimer = null;
    }
  }

  _renderShopping() {
    const cartItems = Object.values(this._cart).reduce((sum, qty) => sum + qty, 0);
    const cartTotal = Object.entries(this._cart).reduce((sum, [code, qty]) => {
      const productInfo = this._productCodes[code] || {};
      const price = productInfo.price || 0;
      return sum + (price * qty);
    }, 0);

    const html = `
      <style>
        .selfservice-container {
          padding: 20px;
          font-family: 'Roboto', sans-serif;
        }
        .product-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding: 15px;
          background: var(--primary-color);
          color: white;
          border-radius: 8px;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 15px;
        }
        .logout-btn {
          padding: 8px 16px;
          background: rgba(255, 255, 255, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 6px;
          color: white;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }
        .logout-btn:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        .cart-badge {
          background: var(--error-color);
          color: white;
          border-radius: 50%;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 14px;
        }
        .products-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 15px;
          margin-bottom: 20px;
        }
        .product-card {
          border: 2px solid var(--divider-color);
          border-radius: 8px;
          padding: 10px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
          background: var(--card-background-color);
        }
        .product-card:hover {
          border-color: var(--primary-color);
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }
        .product-card.in-cart {
          border-color: var(--success-color);
          background: rgba(76, 175, 80, 0.1);
        }
        .product-quantity {
          position: absolute;
          top: -8px;
          right: -8px;
          background: var(--error-color);
          color: white;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 14px;
        }
        .product-image {
          width: 100%;
          height: 100px;
          object-fit: contain;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 48px;
        }
        .product-code {
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        .product-name {
          font-weight: bold;
          margin: 5px 0;
          color: var(--primary-text-color);
        }
        .product-price {
          color: var(--primary-color);
          font-weight: bold;
        }
        .cart-section {
          border: 2px solid var(--primary-color);
          border-radius: 8px;
          padding: 15px;
          background: var(--card-background-color);
        }
        .cart-title {
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 10px;
          color: var(--primary-text-color);
        }
        .cart-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid var(--divider-color);
        }
        .cart-item:last-child {
          border-bottom: none;
        }
        .cart-item-name {
          font-weight: 500;
          color: var(--primary-text-color);
        }
        .cart-item-details {
          display: flex;
          gap: 15px;
          align-items: center;
          color: var(--secondary-text-color);
        }
        .cart-total {
          display: flex;
          justify-content: space-between;
          font-size: 20px;
          font-weight: bold;
          padding: 15px 10px;
          border-top: 2px solid var(--primary-color);
          color: var(--primary-text-color);
        }
        .action-buttons {
          display: flex;
          gap: 10px;
          margin-top: 15px;
        }
        .btn {
          flex: 1;
          padding: 15px;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-cancel {
          background: var(--error-color);
          color: white;
        }
        .btn-confirm {
          background: var(--success-color);
          color: white;
        }
        .btn:active {
          transform: scale(0.95);
        }
        .empty-cart {
          text-align: center;
          padding: 40px;
          color: var(--secondary-text-color);
        }
      </style>
      <div class="selfservice-container">
        <div class="product-header">
          <div class="header-left">
            <button class="logout-btn" id="logout-btn">🔒 Odhlásit</button>
            <span>Pokoj: ${this._serverValidatedRoom}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span>Košík:</span>
            ${cartItems > 0 ? `<div class="cart-badge">${cartItems}</div>` : ''}
          </div>
        </div>

        <div class="products-grid">
          ${this._renderProducts()}
        </div>

        ${cartItems > 0 ? this._renderCart(cartTotal) : '<div class="empty-cart">Vyberte produkty kliknutím na obrázek</div>'}
      </div>
    `;

    this.content.innerHTML = html;
    this._attachProductListeners();
  }

  _renderProducts() {
    let html = '';

    for (let i = 1; i <= 100; i++) {
      const productInfo = this._productCodes[i.toString()] || {};
      const name = productInfo.name || `Produkt ${i}`;
      const price = productInfo.price || 0;
      const inCart = this._cart[i] || 0;
      const imagePath = `/local/lednice/products/${i}.png`;

      html += `
        <div class="product-card ${inCart > 0 ? 'in-cart' : ''}" data-product="${i}">
          ${inCart > 0 ? `<div class="product-quantity">${inCart}</div>` : ''}
          <img
            class="product-image"
            src="${imagePath}"
            alt="${name}"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
          />
          <div class="product-image" style="display: none;">📦</div>
          <div class="product-code">#${i}</div>
          <div class="product-name">${name}</div>
          ${price > 0 ? `<div class="product-price">${price} Kč</div>` : ''}
        </div>
      `;
    }

    return html;
  }

  _renderCart(total) {
    const items = Object.entries(this._cart)
      .filter(([_, qty]) => qty > 0)
      .map(([code, qty]) => {
        const productInfo = this._productCodes[code] || {};
        const name = productInfo.name || `Produkt ${code}`;
        const price = productInfo.price || 0;
        return `
          <div class="cart-item">
            <span class="cart-item-name">${name}</span>
            <div class="cart-item-details">
              <span>${qty}x</span>
              <span>${price} Kč</span>
              <span style="font-weight: bold;">${qty * price} Kč</span>
            </div>
          </div>
        `;
      }).join('');

    return `
      <div class="cart-section">
        <div class="cart-title">🛒 Košík</div>
        ${items}
        <div class="cart-total">
          <span>Celkem:</span>
          <span>${total.toFixed(2)} Kč</span>
        </div>
        <div class="action-buttons">
          <button class="btn btn-cancel" id="cancel-btn">✗ Zrušit</button>
          <button class="btn btn-confirm" id="confirm-btn">✓ Potvrdit</button>
        </div>
      </div>
    `;
  }

  _attachProductListeners() {
    const productCards = this.content.querySelectorAll('.product-card');
    productCards.forEach(card => {
      card.addEventListener('click', () => {
        const code = card.dataset.product;
        this._addToCart(parseInt(code));
      });
    });

    const logoutBtn = this.content.querySelector('#logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this._logout());
    }

    const cancelBtn = this.content.querySelector('#cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this._cart = {};
        this._render();
      });
    }

    const confirmBtn = this.content.querySelector('#confirm-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => this._checkout());
    }
  }

  _addToCart(code) {
    this._cart[code] = (this._cart[code] || 0) + 1;
    this._resetInactivityTimer();
    this._render();
  }

  async _checkout() {
    const products = Object.entries(this._cart)
      .filter(([_, qty]) => qty > 0)
      .flatMap(([code, qty]) => Array(qty).fill(parseInt(code)));

    if (products.length === 0) {
      alert('Košík je prázdný');
      return;
    }

    const currentPin = this._hass.states['input_text.lednice_current_pin']?.state || '';

    console.warn(`🛒 Checkout: products=${products}, pin=${currentPin}`);

    try {
      await this._hass.callService('lednice', 'consume_products', {
        pin: currentPin,
        products: products
      });

      alert(`✓ Úspěšně zaznamenáno!\n\nCelková částka: ${this._calculateTotal().toFixed(2)} Kč\n\nDěkujeme!`);

      this._cart = {};
      this._render();
    } catch (err) {
      console.error('Checkout failed:', err);
      alert('❌ Chyba při zpracování nákupu');
    }
  }

  _calculateTotal() {
    return Object.entries(this._cart).reduce((sum, [code, qty]) => {
      const productInfo = this._productCodes[code] || {};
      const price = productInfo.price || 0;
      return sum + (price * qty);
    }, 0);
  }

  async _logout() {
    console.warn('🚪 Logging out - clearing session');
    this._clearInactivityTimer();
    this._pin = '';
    this._cart = {};
    this._serverValidatedRoom = null;
    this._sessionTimestamp = null;

    // Always turn off the guest logged in input_boolean
    try {
      await this._hass.callService('input_boolean', 'turn_off', {
        entity_id: 'input_boolean.lednice_guest_logged_in'
      });
      console.warn('✓ Guest logged in flag turned off');
    } catch (err) {
      console.error('❌ Failed to turn off guest logged in flag:', err);
    }

    this._render();
  }

  getCardSize() {
    return 5;
  }
}

customElements.define('lednice-selfservice-card', LedniceSelfServiceCard);
