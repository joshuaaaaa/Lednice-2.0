class LedniceProductAdminCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = null;
    this._pin = '';
    this._authenticated = false;
    this._serverValidatedRoom = null;
    this._sessionTimestamp = null;
    this._failedAttempts = 0;
    this._locked = false;
    this._errorMessage = '';
    this._productCodes = {};
    this._editingProduct = null;
    this._formData = {
      code: '',
      name: '',
      price: '',
      barcode: '',
      quantity: ''
    };
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Entity is required');
    }
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;

    // Setup event listener NOW that we have hass
    this._setupEventListener();

    // Load product codes from entity attributes
    const entity = hass.states[this._config.entity];
    if (entity && entity.attributes.product_codes) {
      this._productCodes = entity.attributes.product_codes;
    }

    // Check session timeout
    if (this._authenticated && this._sessionTimestamp) {
      const now = Date.now();
      const sessionTimeout = (this._config.session_timeout || 300) * 1000; // Default 5 minutes
      if (now - this._sessionTimestamp > sessionTimeout) {
        this._authenticated = false;
        this._serverValidatedRoom = null;
        this._sessionTimestamp = null;
      }
    }

    this.render();
  }

  _setupEventListener() {
    if (!this._eventListenerSetup && this._hass) {
      console.log('📡 Setting up event listener for lednice_pin_verified');

      // Listen for PIN verification events from server
      this._hass.connection.subscribeEvents((event) => {
        console.log('📨 Received lednice_pin_verified event:', event.data);
        this._handlePinVerificationEvent(event.data);
      }, 'lednice_pin_verified');

      this._eventListenerSetup = true;
    }
  }

  _handlePinVerificationEvent(data) {
    const { valid, room, pin } = data;

    console.log(`🔐 Server PIN verification result: valid=${valid}, room=${room}, pin=${pin}`);

    if (valid === true && room === 'owner') {
      // ✅ SERVER CONFIRMED - Owner PIN
      console.log(`✅ SERVER APPROVED ACCESS - Owner authenticated`);
      this._authenticated = true;
      this._serverValidatedRoom = room;
      this._sessionTimestamp = Date.now();
      this._failedAttempts = 0;
      this._errorMessage = '';
      this._pin = '';
      this.render();
    } else {
      // ❌ SERVER REJECTED - Invalid PIN or not owner
      console.log('❌ ACCESS DENIED - Invalid PIN or not owner');
      this._authenticated = false;
      this._serverValidatedRoom = null;
      this._failedAttempts++;
      this._pin = '';

      if (valid === true && room !== 'owner') {
        this._errorMessage = 'Přístup pouze pro vlastníka';
      } else {
        this._errorMessage = 'Neplatný PIN';
      }

      if (this._failedAttempts >= 3) {
        this._locked = true;
        this._errorMessage = 'Příliš mnoho pokusů';
        setTimeout(() => {
          this._locked = false;
          this._failedAttempts = 0;
          this._errorMessage = '';
          this.render();
        }, 30000);
      }

      this.render();
    }
  }

  _handlePinInput(digit) {
    if (this._locked) return;

    if (digit === 'clear') {
      this._pin = '';
      this._errorMessage = '';
    } else if (digit === 'enter') {
      if (this._pin.length > 0) {
        this._verifyPin();
      }
    } else {
      if (this._pin.length < 4) {
        this._pin += digit;
      }
      this._errorMessage = ''; // Clear error when user starts typing
    }

    this.render();
  }

  _verifyPin() {
    console.log('Verifying PIN...');
    this._hass.callService('lednice', 'verify_pin', {
      pin: this._pin
    });
  }

  _handleFormInput(field, value) {
    this._formData[field] = value;
    // DON'T call render() - it would lose focus on input fields
  }

  _handleSubmit() {
    const { code, name, price, barcode, quantity } = this._formData;

    // Validation
    if (!code || code < 1 || code > 100) {
      alert('Prosím zadejte číslo produktu mezi 1-100');
      return;
    }

    if (!name || name.trim() === '') {
      alert('Prosím zadejte název produktu');
      return;
    }

    if (!price || price <= 0) {
      alert('Prosím zadejte platnou cenu');
      return;
    }

    if (quantity && (quantity < 0 || !Number.isInteger(parseFloat(quantity)))) {
      alert('Prosím zadejte celé číslo pro počet kusů');
      return;
    }

    // 1. Add/update product code (template)
    this._hass.callService('lednice', 'add_product_code', {
      product_code: parseInt(code),
      product_name: name.trim(),
      price: parseFloat(price),
      code: barcode.trim()
    }).then(() => {
      // 2. If quantity is specified, add to inventory
      if (quantity && parseInt(quantity) > 0) {
        return this._hass.callService('lednice', 'add_item', {
          item_name: name.trim(),
          quantity: parseInt(quantity),
          code: barcode.trim() || undefined
        });
      }
    }).then(() => {
      const msg = this._editingProduct
        ? `Produkt ${code} byl aktualizován!`
        : `Produkt ${code} byl přidán${quantity ? ` a ${quantity} ks přidáno do inventáře` : ''}!`;
      alert(msg);
      this._clearForm();
      this.render();
    }).catch((err) => {
      alert('Chyba při ukládání produktu: ' + err.message);
    });
  }

  _editProduct(code) {
    const product = this._productCodes[code];
    if (product) {
      this._editingProduct = code;
      this._formData = {
        code: code,
        name: product.name || '',
        price: product.price || '',
        barcode: product.barcode || '',
        quantity: '' // Leave empty for editing - product codes don't store quantity
      };
      this.render();
      // Scroll to form
      setTimeout(() => {
        this.shadowRoot.querySelector('.product-form')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }

  _deleteProduct(code) {
    if (confirm(`Opravdu chcete smazat produkt ${code}?`)) {
      this._hass.callService('lednice', 'remove_product_code', {
        product_code: parseInt(code)
      }).then(() => {
        alert(`Produkt ${code} byl smazán!`);
        if (this._editingProduct === code) {
          this._clearForm();
        }
        this.render();
      }).catch((err) => {
        alert('Chyba při mazání produktu: ' + err.message);
      });
    }
  }

  _clearForm() {
    this._editingProduct = null;
    this._formData = {
      code: '',
      name: '',
      price: '',
      barcode: '',
      quantity: ''
    };
    this.render();
  }

  _logout() {
    this._authenticated = false;
    this._serverValidatedRoom = null;
    this._sessionTimestamp = null;
    this._clearForm();
    this.render();
  }

  render() {
    if (!this._config || !this._hass) return;

    const content = this._authenticated ? this._renderProductManager() : this._renderPinScreen();

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          padding: 16px;
        }

        .card {
          background: var(--ha-card-background, var(--card-background-color, white));
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,0.1));
          padding: 24px;
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }

        .card-title {
          font-size: 24px;
          font-weight: 600;
          color: var(--primary-text-color);
          margin: 0;
        }

        .logout-btn {
          background: #f44336;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        }

        .logout-btn:hover {
          background: #d32f2f;
        }

        /* PIN Screen Styles */
        .pin-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
        }

        .pin-title {
          font-size: 20px;
          font-weight: 500;
          color: var(--primary-text-color);
          text-align: center;
        }

        .pin-subtitle {
          font-size: 14px;
          color: var(--secondary-text-color);
          text-align: center;
          margin-top: -16px;
        }

        .pin-display {
          display: flex;
          gap: 12px;
          margin: 8px 0;
        }

        .pin-dot {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color);
          opacity: 0.3;
        }

        .pin-dot.filled {
          opacity: 1;
        }

        .pin-keypad {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          max-width: 300px;
        }

        .pin-key {
          aspect-ratio: 1;
          background: var(--primary-color);
          color: white;
          border: none;
          border-radius: 12px;
          font-size: 24px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .pin-key:hover {
          transform: scale(1.05);
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        .pin-key:active {
          transform: scale(0.95);
        }

        .pin-key.disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .pin-key.disabled:hover {
          transform: none;
        }

        .pin-key.special {
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          font-size: 16px;
        }

        .lockout-message {
          color: #f44336;
          font-weight: 500;
          text-align: center;
        }

        /* Product Manager Styles */
        .product-manager {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .product-form {
          background: var(--secondary-background-color);
          padding: 20px;
          border-radius: 12px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          font-size: 14px;
          font-weight: 500;
          color: var(--primary-text-color);
        }

        .form-group input {
          padding: 10px;
          border: 2px solid var(--divider-color);
          border-radius: 8px;
          font-size: 14px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }

        .form-group input:focus {
          outline: none;
          border-color: var(--primary-color);
        }

        .form-actions {
          grid-column: 1 / -1;
          display: flex;
          gap: 12px;
          margin-top: 8px;
        }

        .btn {
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-primary {
          background: var(--primary-color);
          color: white;
        }

        .btn-primary:hover {
          filter: brightness(1.1);
        }

        .btn-secondary {
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border: 2px solid var(--divider-color);
        }

        .btn-secondary:hover {
          background: var(--divider-color);
        }

        .product-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .product-list-header {
          font-size: 18px;
          font-weight: 600;
          color: var(--primary-text-color);
          margin-bottom: 8px;
        }

        .product-item {
          display: grid;
          grid-template-columns: 60px 1fr auto auto;
          gap: 12px;
          align-items: center;
          padding: 12px;
          background: var(--secondary-background-color);
          border-radius: 8px;
          transition: all 0.2s;
        }

        .product-item:hover {
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .product-code {
          font-size: 20px;
          font-weight: 700;
          color: var(--primary-color);
          text-align: center;
        }

        .product-details {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .product-name {
          font-size: 16px;
          font-weight: 500;
          color: var(--primary-text-color);
        }

        .product-info {
          font-size: 12px;
          color: var(--secondary-text-color);
        }

        .product-actions {
          display: flex;
          gap: 8px;
        }

        .icon-btn {
          width: 36px;
          height: 36px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          transition: all 0.2s;
        }

        .icon-btn.edit {
          background: #2196F3;
          color: white;
        }

        .icon-btn.edit:hover {
          background: #1976D2;
        }

        .icon-btn.delete {
          background: #f44336;
          color: white;
        }

        .icon-btn.delete:hover {
          background: #d32f2f;
        }

        .empty-state {
          text-align: center;
          padding: 40px;
          color: var(--secondary-text-color);
        }

        .empty-state-icon {
          font-size: 48px;
          margin-bottom: 16px;
        }
      </style>

      <div class="card">
        ${content}
      </div>
    `;

    this._attachEventListeners();
  }

  _renderPinScreen() {
    const dots = Array(4).fill(0).map((_, i) =>
      `<div class="pin-dot ${i < this._pin.length ? 'filled' : ''}"></div>`
    ).join('');

    return `
      <div class="pin-container">
        <div class="pin-title">🔒 Správa produktů</div>
        <div class="pin-subtitle">Zadejte PIN vlastníka</div>

        <div class="pin-display">
          ${dots}
        </div>

        ${this._errorMessage ? `<div class="lockout-message">${this._errorMessage}</div>` : ''}

        <div class="pin-keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n =>
            `<button class="pin-key ${this._locked ? 'disabled' : ''}" data-digit="${n}">${n}</button>`
          ).join('')}
          <button class="pin-key special ${this._locked ? 'disabled' : ''}" data-digit="clear">Smazat</button>
          <button class="pin-key ${this._locked ? 'disabled' : ''}" data-digit="0">0</button>
          <button class="pin-key special ${this._locked ? 'disabled' : ''}" data-digit="enter">OK</button>
        </div>
      </div>
    `;
  }

  _renderProductManager() {
    const productList = Object.entries(this._productCodes)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([code, product]) => `
        <div class="product-item">
          <div class="product-code">${code}</div>
          <div class="product-details">
            <div class="product-name">${product.name}</div>
            <div class="product-info">
              Cena: ${product.price} Kč
              ${product.barcode ? ` • Kód: ${product.barcode}` : ''}
            </div>
          </div>
          <button class="icon-btn edit" data-action="edit" data-code="${code}">✏️</button>
          <button class="icon-btn delete" data-action="delete" data-code="${code}">🗑️</button>
        </div>
      `).join('');

    return `
      <div class="card-header">
        <h2 class="card-title">🛒 Správa produktů</h2>
        <button class="logout-btn" data-action="logout">Odhlásit</button>
      </div>

      <div class="product-manager">
        <div class="product-form">
          <div class="form-group">
            <label for="product-code">Číslo produktu (1-100) *</label>
            <input
              type="number"
              id="product-code"
              min="1"
              max="100"
              value="${this._formData.code}"
              data-field="code"
              ${this._editingProduct ? 'readonly' : ''}
            >
          </div>

          <div class="form-group">
            <label for="product-name">Název produktu *</label>
            <input
              type="text"
              id="product-name"
              value="${this._formData.name}"
              data-field="name"
            >
          </div>

          <div class="form-group">
            <label for="product-price">Cena (Kč) *</label>
            <input
              type="number"
              id="product-price"
              step="0.01"
              min="0"
              value="${this._formData.price}"
              data-field="price"
            >
          </div>

          <div class="form-group">
            <label for="product-quantity">Počet kusů (volitelné)</label>
            <input
              type="number"
              id="product-quantity"
              min="0"
              step="1"
              value="${this._formData.quantity}"
              data-field="quantity"
              placeholder="0"
            >
          </div>

          <div class="form-group">
            <label for="product-barcode">Čárový kód (volitelné)</label>
            <input
              type="text"
              id="product-barcode"
              value="${this._formData.barcode}"
              data-field="barcode"
            >
          </div>

          <div class="form-actions">
            <button class="btn btn-primary" data-action="submit">
              ${this._editingProduct ? '💾 Aktualizovat produkt' : '➕ Přidat produkt'}
            </button>
            ${this._editingProduct ? '<button class="btn btn-secondary" data-action="cancel">Zrušit</button>' : ''}
          </div>
        </div>

        <div class="product-list">
          <div class="product-list-header">📦 Seznam produktů (${Object.keys(this._productCodes).length}/100)</div>
          ${productList || '<div class="empty-state"><div class="empty-state-icon">📭</div><div>Zatím nejsou žádné produkty</div></div>'}
        </div>
      </div>
    `;
  }

  _attachEventListeners() {
    // PIN keypad
    this.shadowRoot.querySelectorAll('.pin-key').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const digit = e.target.dataset.digit;
        if (digit) {
          this._handlePinInput(digit);
        }
      });
    });

    // Form inputs
    this.shadowRoot.querySelectorAll('input[data-field]').forEach(input => {
      input.addEventListener('input', (e) => {
        const field = e.target.dataset.field;
        this._handleFormInput(field, e.target.value);
      });
    });

    // Action buttons
    this.shadowRoot.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const code = e.target.dataset.code;

        switch (action) {
          case 'submit':
            this._handleSubmit();
            break;
          case 'cancel':
            this._clearForm();
            break;
          case 'edit':
            this._editProduct(code);
            break;
          case 'delete':
            this._deleteProduct(code);
            break;
          case 'logout':
            this._logout();
            break;
        }
      });
    });
  }

  getCardSize() {
    return 6;
  }
}

customElements.define('lednice-product-admin-card', LedniceProductAdminCard);

// Register card for UI editor
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'lednice-product-admin-card',
  name: 'Lednice Product Admin',
  description: 'PIN-protected card for managing fridge products',
  preview: false,
  documentationURL: 'https://github.com/joshuaaaaa/Lednice-2.0'
});

console.log('%c LEDNICE-PRODUCT-ADMIN-CARD %c v2.0.10 ', 'background: #4CAF50; color: white; font-weight: bold;', 'background: #333; color: white;');
