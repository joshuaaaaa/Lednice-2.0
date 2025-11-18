class LedniceCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) {
      throw new Error('Prosím specifikujte entitu (entity)');
    }

    this.config = config;

    if (!this.content) {
      this.innerHTML = `
        <ha-card>
          <div class="card-header">
            <div class="name"></div>
          </div>
          <div class="card-content"></div>
        </ha-card>
      `;
      this.content = this.querySelector('.card-content');
      this.header = this.querySelector('.name');
    }

    this.header.textContent = config.title || 'Lednice - Inventář';
  }

  set hass(hass) {
    this._hass = hass;

    const entity = hass.states[this.config.entity];
    if (!entity) {
      this.content.innerHTML = `<p>Entita ${this.config.entity} nebyla nalezena</p>`;
      return;
    }

    const inventory = entity.attributes.inventory || {};
    const items = Object.entries(inventory).sort((a, b) => a[0].localeCompare(b[0]));

    // Build inventory table
    let html = `
      <style>
        .lednice-container {
          font-family: var(--paper-font-body1_-_font-family);
        }
        .lednice-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }
        .stat-box {
          background: var(--secondary-background-color);
          padding: 12px;
          border-radius: 8px;
          text-align: center;
        }
        .stat-value {
          font-size: 24px;
          font-weight: bold;
          color: var(--primary-color);
        }
        .stat-label {
          font-size: 12px;
          color: var(--secondary-text-color);
          margin-top: 4px;
        }
        .lednice-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 12px;
        }
        .lednice-table th {
          background: var(--primary-color);
          color: white;
          padding: 12px 8px;
          text-align: left;
          font-weight: 500;
          font-size: 14px;
        }
        .lednice-table td {
          padding: 10px 8px;
          border-bottom: 1px solid var(--divider-color);
        }
        .lednice-table tr:hover {
          background: var(--secondary-background-color);
        }
        .item-name {
          font-weight: 500;
          font-size: 14px;
        }
        .item-code {
          font-size: 12px;
          color: var(--secondary-text-color);
          font-family: monospace;
        }
        .item-quantity {
          font-size: 18px;
          font-weight: bold;
          text-align: center;
        }
        .quantity-low {
          color: var(--error-color);
        }
        .quantity-medium {
          color: var(--warning-color);
        }
        .quantity-good {
          color: var(--success-color);
        }
        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: var(--secondary-text-color);
        }
        .empty-state-icon {
          font-size: 48px;
          margin-bottom: 12px;
        }
        .section-title {
          font-size: 16px;
          font-weight: 500;
          margin: 20px 0 12px 0;
          color: var(--primary-text-color);
        }
      </style>
      <div class="lednice-container">
    `;

    // Statistics
    const totalItems = items.length;
    const totalQuantity = items.reduce((sum, [_, data]) => sum + (data.quantity || 0), 0);
    const lowStockItems = items.filter(([_, data]) => (data.quantity || 0) <= 2).length;

    html += `
      <div class="lednice-stats">
        <div class="stat-box">
          <div class="stat-value">${totalItems}</div>
          <div class="stat-label">Druhy položek</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${totalQuantity}</div>
          <div class="stat-label">Celkem kusů</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${lowStockItems}</div>
          <div class="stat-label">Nízký stav</div>
        </div>
      </div>
    `;

    // Items table
    if (items.length === 0) {
      html += `
        <div class="empty-state">
          <div class="empty-state-icon">🍽️</div>
          <div>Inventář je prázdný</div>
          <div style="font-size: 12px; margin-top: 8px;">
            Přidejte položky pomocí služby lednice.add_item
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="section-title">📦 Skladové zásoby</div>
        <table class="lednice-table">
          <thead>
            <tr>
              <th>Položka</th>
              <th style="text-align: center;">Počet</th>
              <th>Kód</th>
            </tr>
          </thead>
          <tbody>
      `;

      items.forEach(([name, data]) => {
        const quantity = data.quantity || 0;
        let quantityClass = 'quantity-good';
        if (quantity === 0) quantityClass = 'quantity-low';
        else if (quantity <= 2) quantityClass = 'quantity-medium';

        html += `
          <tr>
            <td>
              <div class="item-name">${name}</div>
            </td>
            <td>
              <div class="item-quantity ${quantityClass}">${quantity}</div>
            </td>
            <td>
              <div class="item-code">${data.code || '-'}</div>
            </td>
          </tr>
        `;
      });

      html += `
          </tbody>
        </table>
      `;
    }

    // Room consumption statistics (if consumption sensor exists)
    const consumptionEntity = this.config.consumption_entity;
    if (consumptionEntity) {
      const consumptionState = hass.states[consumptionEntity];
      if (consumptionState) {
        const roomStats = consumptionState.attributes.room_statistics || {};
        const sortedRooms = Object.entries(roomStats).sort((a, b) => b[1] - a[1]);

        if (sortedRooms.length > 0) {
          html += `
            <div class="section-title">🚪 Spotřeba po pokojích</div>
            <table class="lednice-table">
              <thead>
                <tr>
                  <th>Pokoj</th>
                  <th style="text-align: center;">Spotřeba</th>
                </tr>
              </thead>
              <tbody>
          `;

          sortedRooms.forEach(([room, count]) => {
            html += `
              <tr>
                <td><div class="item-name">${room}</div></td>
                <td><div class="item-quantity">${count}</div></td>
              </tr>
            `;
          });

          html += `
              </tbody>
            </table>
          `;
        }
      }
    }

    html += `</div>`;
    this.content.innerHTML = html;
  }

  getCardSize() {
    return 6;
  }

  static getStubConfig() {
    return {
      entity: "sensor.lednice_inventory",
      consumption_entity: "sensor.lednice_consumption"
    };
  }
}

customElements.define('lednice-card', LedniceCard);

// Register the card
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'lednice-card',
  name: 'Lednice Card',
  description: 'Karta pro zobrazení inventáře lednice a spotřeby',
  preview: true,
});

console.info(
  '%c LEDNICE-CARD %c 1.0.0 ',
  'color: white; background: #4CAF50; font-weight: 700;',
  'color: #4CAF50; background: white; font-weight: 700;',
);
