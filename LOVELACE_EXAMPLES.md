# Lednice - Příklady Lovelace Karet

Tento soubor obsahuje příklady konfigurace Lovelace karet pro zobrazení historie a dalších dat z Lednice integrace.

## 📊 1. Historie pohybu zásob (Markdown Card)

Zobrazí posledních 20 záznamů historie včetně přidání, odebrání a úprav.

```yaml
type: markdown
title: 📝 Historie Lednice
content: >-
  {% set history = state_attr('sensor.lednice_history', 'history') %}
  {% if history %}
    {% for entry in history[:20] %}
      {% set timestamp = entry.timestamp | as_datetime | as_local %}
      {% set action_icon = '📥' if entry.action == 'add' else '📤' if entry.action == 'remove' else '✏️' %}
      {% set room_text = entry.room if entry.room else 'N/A' %}
      {% set guest_text = ' (' ~ entry.guest ~ ')' if entry.guest else '' %}

  **{{ action_icon }} {{ timestamp.strftime('%d.%m. %H:%M') }}**
  - **{{ entry.action | upper }}**: {{ entry.item }} ({{ entry.quantity }}x)
  - Pokoj: {{ room_text }}{{ guest_text }}
  {% if entry.details %}
  - {{ entry.details }}
  {% endif %}
  ---
    {% endfor %}
  {% else %}
  *Žádná historie k dispozici*
  {% endif %}

  **Celkem záznamů:** {{ state_attr('sensor.lednice_history', 'total_entries') | default(0) }}

  **Statistiky:**
  - Přidáno: {{ state_attr('sensor.lednice_history', 'total_added') | default(0) }}x
  - Odebráno: {{ state_attr('sensor.lednice_history', 'total_removed') | default(0) }}x
```

---

## 📊 2. Historie pohybu zásob (Kompaktní verze)

Jednodušší zobrazení s ikonami.

```yaml
type: markdown
title: 📝 Historie (Kompaktní)
content: >-
  {% set history = state_attr('sensor.lednice_history', 'history') %}
  {% if history %}
    | Čas | Akce | Položka | Množství | Pokoj |
    |------|------|---------|----------|-------|
    {% for entry in history[:15] %}
      {% set timestamp = entry.timestamp | as_datetime | as_local %}
      {% set action = '➕' if entry.action == 'add' else '➖' if entry.action == 'remove' else '✏️' %}
    | {{ timestamp.strftime('%d.%m %H:%M') }} | {{ action }} | {{ entry.item }} | {{ entry.quantity }}x | {{ entry.room | default('N/A') }} |
    {% endfor %}
  {% else %}
  *Žádná historie*
  {% endif %}
```

---

## 🏨 3. Aktivní Previo rezervace

Zobrazí všechny aktivní rezervace s PINy (platné dnes).

```yaml
type: markdown
title: 🏨 Aktivní Rezervace
content: >-
  {% set previo_pins = state_attr('sensor.lednice_inventory', 'previo_pins') %}
  {% set today = now().date() %}
  {% if previo_pins %}
    {% set active_count = namespace(value=0) %}
    {% for room, pin_data in previo_pins.items() %}
      {% set checkin = pin_data.checkin | as_datetime | as_local %}
      {% set checkout = pin_data.checkout | as_datetime | as_local %}
      {% if today >= checkin.date() and today <= checkout.date() %}
        {% set active_count.value = active_count.value + 1 %}
        {% set room_num = room.replace('room', '') %}
        {% set consumption = state_attr('sensor.lednice_' ~ room ~ '_consumption', 'total_price') | default(0) %}

  ---
  ## 🚪 Pokoj {{ room_num }}

  **👤 Host:** {{ pin_data.guest }}
  **🔑 PIN:** `{{ pin_data.pin }}`
  **📅 Období:** {{ checkin.strftime('%d.%m.') }} - {{ checkout.strftime('%d.%m.%Y') }}
  **💰 Konzumace:** {{ consumption | round(0) }} Kč
      {% endif %}
    {% endfor %}

    {% if active_count.value == 0 %}

  *Žádné aktivní rezervace pro dnešek*
    {% endif %}
  {% else %}

  *Žádné Previo rezervace*
  {% endif %}
```

---

## 📈 4. Statistiky historie

Přehled akcí v historii.

```yaml
type: entities
title: 📈 Statistiky Historie
entities:
  - entity: sensor.lednice_history
    name: Celkem záznamů
    icon: mdi:history
  - type: section
  - type: custom:auto-entities
    card:
      type: glance
      show_name: true
      show_state: true
    filter:
      template: >-
        {% set action_counts = state_attr('sensor.lednice_history', 'action_counts') %}
        {% if action_counts %}
          [
            {% for action, count in action_counts.items() %}
              {
                "entity": "sensor.lednice_history",
                "name": "{{ action | capitalize }}",
                "attribute": "action_counts",
                "icon": "{% if action == 'add' %}mdi:plus-circle{% elif action == 'remove' %}mdi:minus-circle{% else %}mdi:pencil{% endif %}",
                "type": "attribute"
              }{% if not loop.last %},{% endif %}
            {% endfor %}
          ]
        {% endif %}
```

---

## 🎨 5. Plný Dashboard (3 karty vedle sebe)

```yaml
type: vertical-stack
cards:
  # Řádek 1: Aktivní rezervace
  - type: markdown
    title: 🏨 Aktivní Rezervace
    content: >-
      (Viz výše - kód z bodu 3)

  # Řádek 2: Historie a statistiky
  - type: horizontal-stack
    cards:
      # Historie
      - type: markdown
        title: 📝 Historie
        content: >-
          (Viz výše - kód z bodu 2)

      # Statistiky
      - type: glance
        title: 📊 Statistiky
        entities:
          - entity: sensor.lednice_history
            name: Záznamy
          - entity: sensor.lednice_inventory
            name: Položky
          - entity: sensor.lednice_consumption
            name: Konzumace
```

---

## 🌐 6. IFrame pro HTML Dashboard

Pro zobrazení HTML dashboardu rezervací přímo v Home Assistantu:

### Krok 1: Zkopírujte soubor

```bash
cp /path/to/Lednice-2.0/www/lednice-reservations.html /config/www/
```

### Krok 2: Vytvořte Long-Lived Access Token

1. Přejděte do Home Assistant → Profil → Long-Lived Access Tokens
2. Vytvořte nový token (např. "Lednice Dashboard")
3. Zkopírujte token

### Krok 3: Přidejte IFrame kartu

```yaml
type: iframe
url: /local/lednice-reservations.html?token=YOUR_LONG_LIVED_TOKEN_HERE
title: 🏨 Rezervace Dashboard
aspect_ratio: 100%
```

**⚠️ Bezpečnost:** Token je citlivá informace. Ujistěte se, že máte HA zabezpečené heslem/2FA.

---

## 💡 Tipy

### Auto-refresh historie

Přidejte `refresh: 30s` do markdown karty pro automatickou aktualizaci:

```yaml
type: markdown
title: 📝 Historie
refresh: 30
content: >-
  ...
```

### Barevné ikony podle akce

V markdown kartě můžete použít emoji nebo MDI ikony:

- `📥` / `mdi:plus-circle-outline` - Přidání
- `📤` / `mdi:minus-circle-outline` - Odebrání
- `✏️` / `mdi:pencil` - Úprava
- `🔄` / `mdi:refresh` - Reset

---

## 🎯 Hotové řešení

Pokud chcete rychlé řešení, zkopírujte tento kód pro kompletní dashboard:

```yaml
title: Lednice
views:
  - title: Přehled
    path: overview
    cards:
      # Aktivní rezervace
      - type: markdown
        title: 🏨 Aktivní Rezervace
        content: >-
          {% set previo_pins = state_attr('sensor.lednice_inventory', 'previo_pins') %}
          {% set today = now().date() %}
          {% if previo_pins %}
            {% for room, pin_data in previo_pins.items() %}
              {% set checkin = pin_data.checkin | as_datetime | as_local %}
              {% set checkout = pin_data.checkout | as_datetime | as_local %}
              {% if today >= checkin.date() and today <= checkout.date() %}
                {% set room_num = room.replace('room', '') %}
                {% set consumption = state_attr('sensor.lednice_' ~ room ~ '_consumption', 'total_price') | default(0) %}
          ---
          ## 🚪 Pokoj {{ room_num }}
          **👤 Host:** {{ pin_data.guest }}
          **🔑 PIN:** `{{ pin_data.pin }}`
          **📅 Období:** {{ checkin.strftime('%d.%m.') }} - {{ checkout.strftime('%d.%m.%Y') }}
          **💰 Konzumace:** {{ consumption | round(0) }} Kč
              {% endif %}
            {% endfor %}
          {% else %}
          *Žádné aktivní rezervace*
          {% endif %}

      # Historie
      - type: markdown
        title: 📝 Historie Pohybu Zásob
        refresh: 30
        content: >-
          {% set history = state_attr('sensor.lednice_history', 'history') %}
          {% if history %}
            | Čas | Akce | Položka | Množství | Pokoj |
            |------|------|---------|----------|-------|
            {% for entry in history[:15] %}
              {% set timestamp = entry.timestamp | as_datetime | as_local %}
              {% set action = '➕' if entry.action == 'add' else '➖' if entry.action == 'remove' else '✏️' %}
            | {{ timestamp.strftime('%d.%m %H:%M') }} | {{ action }} | {{ entry.item }} | {{ entry.quantity }}x | {{ entry.room | default('N/A') }} |
            {% endfor %}
          {% else %}
          *Žádná historie*
          {% endif %}

          **Statistiky:** Přidáno {{ state_attr('sensor.lednice_history', 'total_added') }}x | Odebráno {{ state_attr('sensor.lednice_history', 'total_removed') }}x

      # Statistiky
      - type: glance
        title: 📊 Přehled
        entities:
          - entity: sensor.lednice_inventory
            name: Položky v Lednici
          - entity: sensor.lednice_history
            name: Záznamy historie
          - entity: sensor.lednice_consumption
            name: Celková konzumace
```

Tento dashboard poskytuje kompletní přehled o Lednici, aktivních rezervacích a historii!
