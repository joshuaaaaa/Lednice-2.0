# 🧾 Self-Service Konzumace - Příklady použití

Tento soubor ukazuje, jak zobrazit hostovi jeho aktuální konzumaci po zadání PINu.

---

## 📱 Příklad 1: Markdown Card s automatizací

### Krok 1: Vytvoř helper pro uložení výsledku

```yaml
# configuration.yaml
input_text:
  lednice_last_pin_result:
    name: "Lednice - Poslední PIN ověření"
    max: 2000

template:
  - sensor:
      - name: "Lednice Aktuální Konzumace"
        unique_id: lednice_current_consumption
        state: >
          {% set data = states('input_text.lednice_last_pin_result') %}
          {% if data and data != 'unknown' %}
            {% set json = data | from_json %}
            {{ json.get('total_price', 0) }}
          {% else %}
            0
          {% endif %}
        unit_of_measurement: "Kč"
        attributes:
          guest_name: >
            {% set data = states('input_text.lednice_last_pin_result') %}
            {% if data and data != 'unknown' %}
              {% set json = data | from_json %}
              {{ json.get('guest_name', 'N/A') }}
            {% else %}
              N/A
            {% endif %}
          room: >
            {% set data = states('input_text.lednice_last_pin_result') %}
            {% if data and data != 'unknown' %}
              {% set json = data | from_json %}
              {{ json.get('room', 'N/A') }}
            {% else %}
              N/A
            {% endif %}
          items: >
            {% set data = states('input_text.lednice_last_pin_result') %}
            {% if data and data != 'unknown' %}
              {% set json = data | from_json %}
              {{ json.get('item_summary', {}) }}
            {% else %}
              {}
            {% endif %}
```

### Krok 2: Automatizace pro zachycení verify_pin události

```yaml
# automations.yaml
automation:
  - alias: "Lednice - Uložit výsledek PIN ověření"
    description: "Zachytí výsledek ověření PINu a uloží ho pro zobrazení"
    trigger:
      - platform: event
        event_type: lednice_pin_verified
    action:
      - service: input_text.set_value
        target:
          entity_id: input_text.lednice_last_pin_result
        data:
          value: "{{ trigger.event.data | to_json }}"
```

### Krok 3: Lovelace karta

```yaml
type: markdown
title: 🧾 Vaše Konzumace
content: >-
  {% set data = states('input_text.lednice_last_pin_result') %}

  {% if data and data != 'unknown' and data != '' %}
    {% set json = data | from_json %}
    {% if json.valid %}
      ## 👤 {{ json.guest_name or 'Host' }}
      **🚪 Pokoj:** {{ json.room.replace('room', '') }}

      {% if json.checkin %}
      **📅 Období:** {{ json.checkin | as_datetime | as_local | string | replace('-', '.') | truncate(10, True, '') }} - {{ json.checkout | as_datetime | as_local | string | replace('-', '.') | truncate(10, True, '') }}
      {% endif %}

      ---

      ### 🛒 Konzumované položky:

      {% if json.item_summary %}
        | Položka | Množství | Cena/ks | Celkem |
        |---------|----------|---------|--------|
        {% for item, details in json.item_summary.items() %}
        | {{ item }} | {{ details.quantity }}x | {{ details.unit_price }} Kč | **{{ details.total_price | round(0) }} Kč** |
        {% endfor %}
      {% else %}
      *Zatím žádná konzumace*
      {% endif %}

      ---

      ## 💰 Celkem k úhradě: **{{ json.total_price | round(0) }} Kč**

      *Celkem položek: {{ json.total_items }}*

    {% else %}
      ## ❌ Neplatný PIN
      Zadejte správný PIN pro zobrazení konzumace.
    {% endif %}
  {% else %}
    ## 🔐 Zadejte PIN
    Pro zobrazení konzumace použijte tlačítko níže a zadejte váš PIN kód.
  {% endif %}
```

---

## 📱 Příklad 2: Custom Button Card s dialogem

### Vyžaduje: custom:button-card

```yaml
type: custom:button-card
name: Zobrazit mou konzumaci
icon: mdi:receipt-text
tap_action:
  action: call-service
  service: browser_mod.popup
  service_data:
    title: "🔐 Zadejte PIN"
    content:
      type: vertical-stack
      cards:
        - type: entities
          entities:
            - entity: input_text.lednice_pin_input
              name: "PIN kód"
        - type: button
          name: "Ověřit a zobrazit konzumaci"
          icon: mdi:check
          tap_action:
            action: call-service
            service: lednice.verify_pin
            service_data:
              pin: "{{ states('input_text.lednice_pin_input') }}"
        - type: markdown
          content: >-
            {% set data = states('input_text.lednice_last_pin_result') %}
            {% if data and data != 'unknown' %}
              {% set json = data | from_json %}
              {% if json.valid %}
                **Celkem:** {{ json.total_price }} Kč
              {% endif %}
            {% endif %}
```

---

## 📱 Příklad 3: Kompletní Self-Service Dashboard

### Konfigurace (configuration.yaml):

```yaml
input_text:
  lednice_pin_input:
    name: "PIN pro přihlášení"
    max: 4
    mode: password
    icon: mdi:form-textbox-password

  lednice_last_pin_result:
    name: "Výsledek ověření"
    max: 2000

input_boolean:
  lednice_show_consumption:
    name: "Zobrazit konzumaci"
    initial: false
```

### Automatizace:

```yaml
automation:
  # Uložit výsledek PIN ověření
  - alias: "Lednice - Zachytit PIN výsledek"
    trigger:
      - platform: event
        event_type: lednice_pin_verified
    action:
      - service: input_text.set_value
        target:
          entity_id: input_text.lednice_last_pin_result
        data:
          value: "{{ trigger.event.data | to_json }}"

      # Zobrazit konzumaci pokud je PIN platný
      - service: input_boolean.turn_{{ 'on' if trigger.event.data.valid else 'off' }}
        target:
          entity_id: input_boolean.lednice_show_consumption

  # Vymazat PIN po 5 minutách
  - alias: "Lednice - Auto vymazání PIN"
    trigger:
      - platform: state
        entity_id: input_boolean.lednice_show_consumption
        to: "on"
        for:
          minutes: 5
    action:
      - service: input_boolean.turn_off
        target:
          entity_id: input_boolean.lednice_show_consumption
      - service: input_text.set_value
        target:
          entity_id: input_text.lednice_pin_input
        data:
          value: ""
```

### Lovelace Dashboard:

```yaml
type: vertical-stack
cards:
  # PIN Input Card
  - type: conditional
    conditions:
      - entity: input_boolean.lednice_show_consumption
        state: "off"
    card:
      type: vertical-stack
      cards:
        - type: markdown
          content: |
            # 🏨 Self-Service Lednice

            Vítejte! Pro zobrazení vaší aktuální konzumace zadejte PIN kód z vašeho pokoje.

        - type: entities
          entities:
            - entity: input_text.lednice_pin_input
              name: "🔐 Zadejte PIN"

        - type: button
          name: "Přihlásit se"
          icon: mdi:login
          tap_action:
            action: call-service
            service: lednice.verify_pin
            service_data:
              pin: "{{ states('input_text.lednice_pin_input') }}"

  # Consumption Display Card
  - type: conditional
    conditions:
      - entity: input_boolean.lednice_show_consumption
        state: "on"
    card:
      type: vertical-stack
      cards:
        - type: markdown
          content: >-
            {% set data = states('input_text.lednice_last_pin_result') %}
            {% set json = data | from_json %}

            # 👤 {{ json.guest_name or 'Vážený hoste' }}

            **🚪 Pokoj:** {{ json.room.replace('room', '') }}

            {% if json.checkin %}
            **📅 Pobyt:** {{ json.checkin[:10] }} - {{ json.checkout[:10] }}
            {% endif %}

            ---

            ## 🛒 Vaše konzumace:

            {% if json.item_summary %}
              | Položka | Počet | Cena |
              |---------|-------|------|
              {% for item, details in json.item_summary.items() %}
              | {{ item }} | {{ details.quantity }}x | {{ details.total_price | round(0) }} Kč |
              {% endfor %}
            {% else %}
            *Zatím jste nic nekonzumovali* ✅
            {% endif %}

            ---

            # 💰 Celkem: {{ json.total_price | round(0) }} Kč

            *Tuto částku zaplatíte při check-outu na recepci.*

        - type: button
          name: "Odhlásit se"
          icon: mdi:logout
          tap_action:
            action: call-service
            service: input_boolean.turn_off
            service_data:
              entity_id: input_boolean.lednice_show_consumption
```

---

## 🌐 Příklad 4: HTML Self-Service stránka

### Vytvoř soubor: `/config/www/lednice-selfservice.html`

```html
<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lednice - Moje Konzumace</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            margin: 0;
        }

        .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }

        h1 {
            color: #667eea;
            text-align: center;
        }

        .pin-input {
            display: flex;
            gap: 10px;
            margin: 20px 0;
        }

        input[type="password"] {
            flex: 1;
            padding: 15px;
            font-size: 18px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            text-align: center;
            letter-spacing: 5px;
        }

        button {
            padding: 15px 30px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            cursor: pointer;
            font-weight: bold;
        }

        button:hover {
            transform: scale(1.05);
        }

        .consumption {
            margin-top: 30px;
            display: none;
        }

        .consumption.show {
            display: block;
        }

        .item-list {
            background: #f5f5f5;
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
        }

        .item {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #e0e0e0;
        }

        .item:last-child {
            border-bottom: none;
        }

        .total {
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
            text-align: center;
            margin-top: 20px;
            padding: 20px;
            background: #f0f4ff;
            border-radius: 10px;
        }

        .error {
            color: red;
            text-align: center;
            margin-top: 10px;
            display: none;
        }

        .error.show {
            display: block;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏨 Moje Konzumace</h1>

        <div id="loginSection">
            <p style="text-align: center; color: #666;">
                Zadejte PIN kód z vašeho pokoje
            </p>

            <div class="pin-input">
                <input type="password" id="pinInput" maxlength="4" placeholder="••••">
                <button onclick="verifyPin()">Přihlásit</button>
            </div>

            <div class="error" id="errorMsg">Neplatný PIN</div>
        </div>

        <div class="consumption" id="consumptionSection">
            <h2 id="guestName">👤 Host</h2>
            <p id="roomInfo">🚪 Pokoj: <span id="roomNumber"></span></p>
            <p id="stayInfo">📅 Pobyt: <span id="stayDates"></span></p>

            <h3>🛒 Konzumované položky:</h3>
            <div class="item-list" id="itemList">
                <!-- Dynamicky generováno -->
            </div>

            <div class="total" id="totalPrice">
                💰 Celkem: 0 Kč
            </div>

            <button onclick="logout()" style="width: 100%; margin-top: 20px;">
                Odhlásit se
            </button>
        </div>
    </div>

    <script>
        const HA_URL = window.location.origin;
        const TOKEN = new URLSearchParams(window.location.search).get('token') ||
                     localStorage.getItem('ha_token');

        if (!TOKEN) {
            alert('Chybí token! Přidejte ?token=YOUR_TOKEN do URL');
        }

        async function verifyPin() {
            const pin = document.getElementById('pinInput').value;

            if (!pin || pin.length !== 4) {
                showError('Zadejte 4místný PIN');
                return;
            }

            try {
                const response = await fetch(`${HA_URL}/api/services/lednice/verify_pin`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        pin: pin
                    })
                });

                const result = await response.json();

                if (result[0].valid) {
                    showConsumption(result[0]);
                } else {
                    showError('Neplatný PIN');
                }
            } catch (error) {
                console.error('Error:', error);
                showError('Chyba při ověřování');
            }
        }

        function showConsumption(data) {
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('consumptionSection').classList.add('show');

            document.getElementById('guestName').textContent =
                '👤 ' + (data.guest_name || 'Vážený hoste');
            document.getElementById('roomNumber').textContent =
                data.room.replace('room', '');

            if (data.checkin && data.checkout) {
                document.getElementById('stayDates').textContent =
                    `${data.checkin.substring(0, 10)} - ${data.checkout.substring(0, 10)}`;
            }

            const itemList = document.getElementById('itemList');
            itemList.innerHTML = '';

            if (data.item_summary && Object.keys(data.item_summary).length > 0) {
                for (const [item, details] of Object.entries(data.item_summary)) {
                    const div = document.createElement('div');
                    div.className = 'item';
                    div.innerHTML = `
                        <span><strong>${item}</strong> (${details.quantity}x)</span>
                        <span>${Math.round(details.total_price)} Kč</span>
                    `;
                    itemList.appendChild(div);
                }
            } else {
                itemList.innerHTML = '<p style="text-align: center; color: #666;">Zatím žádná konzumace ✅</p>';
            }

            document.getElementById('totalPrice').textContent =
                `💰 Celkem: ${Math.round(data.total_price)} Kč`;
        }

        function showError(msg) {
            const errorEl = document.getElementById('errorMsg');
            errorEl.textContent = msg;
            errorEl.classList.add('show');

            setTimeout(() => {
                errorEl.classList.remove('show');
            }, 3000);
        }

        function logout() {
            document.getElementById('consumptionSection').classList.remove('show');
            document.getElementById('loginSection').style.display = 'block';
            document.getElementById('pinInput').value = '';
        }

        // Enter key support
        document.getElementById('pinInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                verifyPin();
            }
        });
    </script>
</body>
</html>
```

### Použití HTML stránky:

1. Zkopíruj HTML do `/config/www/lednice-selfservice.html`
2. Vytvoř Long-Lived Token
3. Přidej IFrame kartu:

```yaml
type: iframe
url: /local/lednice-selfservice.html?token=YOUR_TOKEN
aspect_ratio: 100%
```

Nebo vytvoř QR kód s URL pro hosty!

---

## 📋 Struktura odpovědi služby verify_pin

```json
{
  "pin": "1234",
  "valid": true,
  "room": "room3",
  "guest_name": "Jan Novák",
  "checkin": "2025-11-20",
  "checkout": "2025-11-25",
  "total_price": 350.0,
  "total_items": 12,
  "consumption_count": 8,
  "item_summary": {
    "Coca Cola": {
      "quantity": 3,
      "unit_price": 35.0,
      "total_price": 105.0
    },
    "Pivo": {
      "quantity": 5,
      "unit_price": 40.0,
      "total_price": 200.0
    },
    "Chips": {
      "quantity": 4,
      "unit_price": 25.0,
      "total_price": 100.0
    }
  }
}
```

---

## 🎯 Doporučené použití:

1. **Tablet u lednice** - Zobrazit HTML self-service stránku
2. **QR kód v pokoji** - Link na self-service
3. **Info panel na recepci** - Markdown karta s konzumacemi všech pokojů

**Výhody:**
- ✅ Host vidí hned co má zaplatit
- ✅ Transparentnost
- ✅ Snížení dotazů na recepci
- ✅ Prevence sporů o účty
