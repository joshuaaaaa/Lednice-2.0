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

class LedniceSelfServiceCard extends HTMLElement {
  constructor() {
    super();
    this._pin = '';
    this._cart = {}; 
    this._productCodes = {};
    this._inactivityTimer = null;
    this._inactivityTimeout = 60000;
    this._failedAttempts = 0;
    this._locked = false;
    this._lockTimer = null;
    
    // SERVER VALIDATED STATE - never set manually!
    this._serverValidatedRoom = null;
    this._sessionTimestamp = null;
    this._sessionTimeout = 60000; // Session expires after 60 seconds of no server contact
    
    console.warn('🚀 LEDNICE SECURE CARD - VERSION 2025-11-18-SERVER-AUTH');
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Prosím specifikujte entitu inventáře (entity)');
    }

    this.config = config;
    this._inactivityTimeout = (config.inactivity_timeout || 60) * 1000;
    
    this._render();
  }

  set hass(hass) {
    this._hass = hass;

    const inventoryEntity = hass.states[this.config.entity];
    if (inventoryEntity && inventoryEntity.attributes.product_codes) {
      this._productCodes = inventoryEntity.attributes.product_codes;
    }
    
    // Setup event listener NOW that we have hass
    this._setupEventListener();
  }

  _setupEventListener() {
    if (!this._eventListenerSetup && this._hass) {
      console.warn('📡 Setting up event listener for lednice_pin_verified');
      
      // Listen for PIN verification events from server
      this._hass.connection.subscribeEvents((event) => {
        console.warn('📨 Received lednice_pin_verified event:', event.data);
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
    } else {
      // ❌ SERVER REJECTED - Invalid PIN
      console.warn('❌ SERVER DENIED ACCESS');
      this._serverValidatedRoom = null;
      this._sessionTimestamp = null;
      this._failedAttempts++;
      
      const errorEl = this.content?.querySelector('#pin-error');
      if (errorEl) errorEl.textContent = 'Neplatný PIN';
      
      this._pin = '';
      const pinDisplay = this.content?.querySelector('#pin-display');
      if (pinDisplay) pinDisplay.value = '';
      
      if (this._failedAttempts >= 3) {
        this._lockCard();
      } else {
        this._render();
      }
    }
  }

  _isSessionValid() {
    if (!this._serverValidatedRoom || !this._sessionTimestamp) {
      return false;
    }
    
    const sessionAge = Date.now() - this._sessionTimestamp;
    const isValid = sessionAge < this._sessionTimeout;
    
    if (!isValid) {
      console.warn('⏰ Session expired');
      this._serverValidatedRoom = null;
      this._sessionTimestamp = null;
    }
    
    return isValid;
  }

  _render() {
    if (!this.content) {
      this.innerHTML = `
        <ha-card>
          <div class="card-header">
            <div class="name">${this.config.title || 'Samoobslužná lednice'}</div>
          </div>
          <div class="card-content"></div>
        </ha-card>
      `;
      this.content = this.querySelector('.card-content');
    }

    // CRITICAL: Check if we have SERVER-VALIDATED session
    if (this._isSessionValid()) {
      console.warn('🔓 Valid server session - Showing products');
      this._renderProductScreen();
    } else {
      console.warn('🔒 No valid session - Showing PIN screen');
      this._serverValidatedRoom = null;
      this._sessionTimestamp = null;
      this._renderPinScreen();
    }
  }

  _renderPinScreen() {
    const isLocked = this._locked;
    const buttonDisabled = isLocked ? 'disabled' : '';

    const html = `
      <style>
        .selfservice-container {
          font-family: var(--paper-font-body1_-_font-family);
          padding: 20px;
        }
        .pin-screen {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          padding: 40px 20px;
        }
        .pin-title {
          font-size: 24px;
          font-weight: 500;
          color: var(--primary-text-color);
        }
        .pin-subtitle {
          font-size: 14px;
          color: var(--secondary-text-color);
          text-align: center;
        }
        .pin-input {
          font-size: 32px;
          padding: 15px 30px;
          border: 2px solid var(--primary-color);
          border-radius: 8px;
          text-align: center;
          letter-spacing: 10px;
          width: 200px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        .pin-input.error {
          border-color: var(--error-color);
          animation: shake 0.5s;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-10px); }
          75% { transform: translateX(10px); }
        }
        .pin-keypad {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 15px;
          max-width: 300px;
        }
        .pin-button {
          font-size: 24px;
          padding: 20px;
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
        .pin-error {
          color: var(--error-color);
          font-size: 16px;
          margin-top: 10px;
          font-weight: bold;
          min-height: 24px;
        }
        .pin-warning {
          color: var(--warning-color, orange);
          font-size: 14px;
          margin-top: 5px;
        }
        .security-badge {
          background: var(--success-color);
          color: white;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 12px;
          margin-top: 20px;
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

      // Call Home Assistant service - get response directly
      const response = await this._hass.callService('lednice', 'verify_pin', {
        pin: this._pin
      }, { return_response: true });

      console.warn('📡 Service response received:', response);

      // Process response immediately (faster than waiting for event)
      if (response && response.response) {
        this._handlePinVerificationEvent(response.response);
      } else {
        console.warn('⚠️ No response data, falling back to event listener');
        // Event listener will handle it
      }

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

  _renderProductScreen() {
    // TRIPLE CHECK: Session must be valid from server
    if (!this._isSessionValid()) {
      console.error('❌ SECURITY: Attempted to render products without valid server session');
      this._logout();
      return;
    }

    const productCodes = this._productCodes || {};
    const cartItems = Object.keys(this._cart).length;
    const cartTotal = this._calculateTotal();

    const html = `
      <style>
        .selfservice-container {
          font-family: var(--paper-font-body1_-_font-family);
        }
        .product-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px;
          background: var(--primary-color);
          color: white;
        }
        .header-left {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .logout-btn {
          padding: 8px 16px;
          background: rgba(255,255,255,0.2);
          border: none;
          border-radius: 4px;
          color: white;
          cursor: pointer;
          font-size: 14px;
        }
        .cart-badge {
          background: var(--error-color);
          color: white;
          border-radius: 50%;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
        }
        .products-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 15px;
          padding: 20px;
          max-height: 60vh;
          overflow-y: auto;
        }
        .product-card {
          background: var(--card-background-color);
          border: 2px solid var(--divider-color);
          border-radius: 8px;
          padding: 10px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
          text-align: center;
        }
        .product-card:hover {
          border-color: var(--primary-color);
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        .product-card.in-cart {
          border-color: var(--success-color);
          background: rgba(76, 175, 80, 0.1);
        }
        .product-image {
          width: 100%;
          height: 80px;
          object-fit: contain;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 40px;
        }
        .product-code {
          font-size: 12px;
          color: var(--secondary-text-color);
          font-weight: bold;
        }
        .product-name {
          font-size: 13px;
          margin-top: 4px;
          color: var(--primary-text-color);
        }
        .product-price {
          font-size: 12px;
          color: var(--success-color);
          font-weight: bold;
          margin-top: 4px;
        }
        .product-quantity {
          position: absolute;
          top: 5px;
          right: 5px;
          background: var(--success-color);
          color: white;
          border-radius: 50%;
          width: 25px;
          height: 25px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 12px;
        }
        .cart-summary {
          background: var(--secondary-background-color);
          padding: 20px;
          margin: 20px;
          border-radius: 8px;
        }
        .cart-items {
          margin-bottom: 15px;
        }
        .cart-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px;
          border-bottom: 1px solid var(--divider-color);
        }
        .cart-item:last-child {
          border-bottom: none;
        }
        .cart-item-controls {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .qty-btn {
          width: 30px;
          height: 30px;
          border: none;
          border-radius: 4px;
          background: var(--primary-color);
          color: white;
          cursor: pointer;
          font-size: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .qty-btn:active {
          transform: scale(0.9);
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
        const subtotal = price * qty;

        return `
          <div class="cart-item">
            <div>
              <strong>${name}</strong> (#${code})
              <div style="font-size: 12px; color: var(--secondary-text-color);">
                ${price} Kč × ${qty} = ${subtotal.toFixed(2)} Kč
              </div>
            </div>
            <div class="cart-item-controls">
              <button class="qty-btn" data-action="decrease" data-code="${code}">−</button>
              <span style="min-width: 30px; text-align: center; font-weight: bold;">${qty}</span>
              <button class="qty-btn" data-action="increase" data-code="${code}">+</button>
            </div>
          </div>
        `;
      }).join('');

    return `
      <div class="cart-summary">
        <div class="cart-items">
          ${items}
        </div>
        <div class="cart-total">
          <span>Celkem k úhradě:</span>
          <span>${total.toFixed(2)} Kč</span>
        </div>
        <div class="action-buttons">
          <button class="btn btn-cancel" id="clear-cart">Zrušit</button>
          <button class="btn btn-confirm" id="confirm-purchase">Hotovo ✓</button>
        </div>
      </div>
    `;
  }

  _attachProductListeners() {
    const productCards = this.content.querySelectorAll('.product-card');
    productCards.forEach(card => {
      card.addEventListener('click', (e) => {
        this._resetInactivityTimer();
        const productCode = parseInt(e.currentTarget.dataset.product);
        this._addToCart(productCode);
      });
    });

    const qtyBtns = this.content.querySelectorAll('.qty-btn');
    qtyBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._resetInactivityTimer();
        const action = e.target.dataset.action;
        const code = parseInt(e.target.dataset.code);

        if (action === 'increase') {
          this._addToCart(code);
        } else if (action === 'decrease') {
          this._removeFromCart(code);
        }
      });
    });

    const clearBtn = this.content.querySelector('#clear-cart');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this._resetInactivityTimer();
        this._cart = {};
        this._render();
      });
    }

    const confirmBtn = this.content.querySelector('#confirm-purchase');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        this._resetInactivityTimer();
        this._confirmPurchase();
      });
    }

    const logoutBtn = this.content.querySelector('#logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        this._logout();
      });
    }

    const productsGrid = this.content.querySelector('.products-grid');
    if (productsGrid) {
      productsGrid.addEventListener('scroll', () => {
        this._resetInactivityTimer();
      }, { passive: true });
    }
  }

  _addToCart(productCode) {
    if (!this._cart[productCode]) {
      this._cart[productCode] = 0;
    }
    this._cart[productCode]++;
    this._render();
  }

  _removeFromCart(productCode) {
    if (this._cart[productCode]) {
      this._cart[productCode]--;
      if (this._cart[productCode] <= 0) {
        delete this._cart[productCode];
      }
    }
    this._render();
  }

  _calculateTotal() {
    let total = 0;
    for (const [code, qty] of Object.entries(this._cart)) {
      const productInfo = this._productCodes[code] || {};
      const price = productInfo.price || 0;
      total += price * qty;
    }
    return total;
  }

  async _confirmPurchase() {
    // Get PIN from current validated session (we need it for consume_products service)
    // Note: The server will validate it again on consume_products
    const inventoryEntity = this._hass.states[this.config.entity];
    const roomPins = inventoryEntity?.attributes?.room_pins || {};
    
    // Find PIN for current room
    let currentPin = null;
    for (const [room, pin] of Object.entries(roomPins)) {
      if (room === this._serverValidatedRoom) {
        currentPin = pin;
        break;
      }
    }
    
    if (!currentPin) {
      alert('Chyba: Nepodařilo se najít PIN pro aktuální místnost');
      this._logout();
      return;
    }
    
    const products = [];
    for (const [code, qty] of Object.entries(this._cart)) {
      for (let i = 0; i < qty; i++) {
        products.push(parseInt(code));
      }
    }

    if (products.length === 0) {
      return;
    }

    try {
      await this._hass.callService('lednice', 'consume_products', {
        pin: currentPin,
        products: products
      });

      alert(`✓ Úspěšně zaznamenáno!\n\nCelková částka: ${this._calculateTotal().toFixed(2)} Kč\n\nDěkujeme!`);

      this._cart = {};
      this._logout();
    } catch (err) {
      alert('Chyba při zpracování: ' + err.message);
    }
  }

  _logout() {
    console.warn('🚪 Logging out - clearing session');
    this._clearInactivityTimer();
    this._pin = '';
    this._cart = {};
    this._serverValidatedRoom = null;
    this._sessionTimestamp = null;
    this._render();
  }

  getCardSize() {
    return 10;
  }

  static getStubConfig() {
    return {
      entity: "sensor.lednice_inventory",
      title: "Samoobslužná lednice"
    };
  }
}

customElements.define('lednice-selfservice-card', LedniceSelfServiceCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'lednice-selfservice-card',
  name: 'Lednice Self-Service Card',
  description: 'Samoobslužná karta s server-side validací',
  preview: true,
});

console.info(
  '%c LEDNICE-SELFSERVICE-CARD %c 2.0.9-SERVER-AUTH ',
  'color: white; background: #2196F3; font-weight: 700;',
  'color: #2196F3; background: white; font-weight: 700;',
);
