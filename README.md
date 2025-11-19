# Lednice - Fridge Inventory Manager

🇨🇿 **Chytrá samoobslužná lednice pro Home Assistant**

Aplikace pro správu inventáře samoobslužné lednice v penzionu s podporou čtečky čárových kódů, PIN autentizace pro pokoje a kompletní evidencí spotřeby včetně cen.

## ✨ Funkce

- 📦 **Správa inventáře** - Přidávání, odebírání a aktualizace položek
- 🔍 **Čárové kódy** - Skenování kódů pro automatické odebrání položek
- 🔐 **PIN autentizace** - Přiřazení spotřeby ke konkrétnímu pokoji (room1-room10 + owner)
- 💰 **Produktové kódy** - 100 produktových kódů s názvy, cenami a obrázky
- 📱 **Self-service karta** - Tablet na zdi s PIN vstupem a výběrem produktů
- 💵 **Cenová kalkulace** - Automatický výpočet částky k úhradě pro každý pokoj
- 📊 **Statistiky** - Detailní přehled spotřeby a příjmů po pokojích
- 🎨 **Vlastní karty** - Krásné Lovelace karty pro zobrazení i samoobsluhu
- 💾 **Perzistentní ukládání** - Všechna data jsou uložena a přežijí restart

## 📥 Instalace

### HACS (Doporučeno)

1. Otevřete HACS v Home Assistant
2. Klikněte na "Integrations"
3. Klikněte na tři tečky vpravo nahoře a vyberte "Custom repositories"
4. Přidejte URL: `https://github.com/joshuaaaaa/Lednice`
5. Kategorie: `Integration`
6. Klikněte na "Add"
7. Najděte "Lednice" v seznamu a klikněte na "Download"
8. Restartujte Home Assistant

### Manuální instalace

1. Zkopírujte složku `custom_components/lednice` do vaší složky `config/custom_components/`
2. Zkopírujte soubory z `www/` do vaší složky `config/www/`:
   - `lednice-card.js` - Karta pro zobrazení inventáře
   - `lednice-selfservice-card.js` - Karta pro samoobsluhu
   - `lednice-product-admin-card.js` - Karta pro správu produktů
3. Vytvořte složku `config/www/lednice/products/` pro obrázky produktů
4. Restartujte Home Assistant

## ⚙️ Konfigurace

### Přidání integrace

1. Přejděte do **Nastavení** → **Zařízení a služby**
2. Klikněte na **+ Přidat integraci**
3. Vyhledejte **Lednice**
4. Zadejte název (výchozí: "Lednice")
5. Klikněte na **Odeslat**

### Nastavení PIN kódů pro pokoje

1. V **Zařízení a služby** najděte integraci **Lednice**
2. Klikněte na **Konfigurovat**
3. Nastavte PIN kódy pro jednotlivé pokoje (room1 až room10)
4. Uložte změny

**Výchozí PIN:**
- `0000` - Majitelský pokoj (owner) - pro testování a správu

### Nastavení produktových kódů

Pro samoobslužnou lednici je potřeba nastavit produktové kódy (1-100):

```yaml
service: lednice.add_product_code
data:
  product_code: 1
  product_name: "Coca Cola 0.5L"
  price: 35.0
  code: "8594001652419"  # Volitelný čárový kód
```

**Obrázky produktů:**
Umístěte obrázky do složky `/config/www/lednice/products/`:
- `/local/lednice/products/1.png` - Obrázek pro produkt #1
- `/local/lednice/products/2.png` - Obrázek pro produkt #2
- atd. až `/local/lednice/products/100.png`

## 📱 Přidání karty do dashboardu

### Registrace custom kart

Přidejte do dashboardu:

1. Otevřete váš dashboard v režimu úprav
2. Klikněte na tři tečky vpravo nahoře
3. Vyberte **Spravovat zdroje**
4. Přidejte všechny tři karty:
   - URL: `/local/lednice-card.js` - Typ: **JavaScript modul**
   - URL: `/local/lednice-selfservice-card.js` - Typ: **JavaScript modul**
   - URL: `/local/lednice-product-admin-card.js` - Typ: **JavaScript modul**
5. Klikněte na **Vytvořit**

### Karta pro správu inventáře

Pro přehled a správu inventáře:

```yaml
type: custom:lednice-card
entity: sensor.lednice_inventory
consumption_entity: sensor.lednice_consumption
title: Lednice - Inventář
```

### Karta pro samoobsluhu (Tablet na zdi)

Pro hosty v penzionu - samoobslužný výběr produktů:

```yaml
type: custom:lednice-selfservice-card
entity: sensor.lednice_inventory
title: Samoobslužná lednice
inactivity_timeout: 60  # Automatické odhlášení po 60 sekundách nečinnosti (volitelné)
```

**Konfigurace:**
- `entity` (povinné) - Sensor inventáře (např. `sensor.lednice_inventory`)
- `title` (volitelné) - Název karty (výchozí: "Samoobslužná lednice")
- `inactivity_timeout` (volitelné) - Timeout v sekundách pro automatické odhlášení (výchozí: 60)

**Funkce self-service karty:**
- 🔐 **PIN vstup** - Host zadá PIN svého pokoje
- 📦 **Produktový grid** - Výběr z produktů 1-100 s obrázky
- 🛒 **Košík** - Přehled vybraných položek s cenami
- ✓ **Hotovo** - Potvrzení a automatický zápis spotřeby
- 💰 **Celková částka** - Zobrazení částky k úhradě
- ⏱️ **Auto-logout** - Automatické odhlášení po nečinnosti (výchozí 60s)

**Doporučené nastavení pro tablet:**
- Fullscreen mód
- Kiosk mode (pomocí HACS addon "Kiosk Mode")
- Nastavte `inactivity_timeout` podle potřeby (např. 120 pro 2 minuty)

### Karta pro správu produktů (PIN ochrana)

Pro snadnou správu produktové databáze - pouze pro vlastníka:

```yaml
type: custom:lednice-product-admin-card
entity: sensor.lednice_inventory
title: Správa produktů
session_timeout: 300  # Automatické odhlášení po 5 minutách (volitelné)
```

**Konfigurace:**
- `entity` (povinné) - Sensor inventáře (např. `sensor.lednice_inventory`)
- `title` (volitelné) - Název karty (výchozí: "Správa produktů")
- `session_timeout` (volitelné) - Timeout v sekundách pro automatické odhlášení (výchozí: 300)

**Funkce karty:**
- 🔒 **PIN ochrana** - Přístup pouze s PIN vlastníka (0000)
- ➕ **Přidávání produktů** - Formulář pro kód (1-100), název, cenu a čárový kód
- ✏️ **Editace produktů** - Jednoduchá úprava existujících produktů
- 🗑️ **Mazání produktů** - Odstranění produktu s potvrzením
- 📋 **Přehled produktů** - Seznam všech produktů s detaily
- 🔐 **Zabezpečení** - Lockout po 3 neúspěšných pokusech (30 sekund)
- ⏱️ **Auto-logout** - Automatické odhlášení po nečinnosti (výchozí 5 minut)

**Výhody oproti službám:**
- ✓ User-friendly webové rozhraní místo YAML
- ✓ Okamžitý vizuální přehled všech produktů
- ✓ Rychlá editace bez psaní služeb
- ✓ Ochrana PIN kódem - nedostupné hostům
- ✓ Ideální pro tablet nebo mobilní správu

## 🚀 Použití

### Entity

Po instalaci budou vytvořeny následující entity:

- `sensor.lednice_inventory` - Hlavní inventář s detaily položek a produktovými kódy
- `sensor.lednice_consumption` - Celková spotřeba, statistiky a příjmy
- `sensor.lednice_room1_consumption` až `sensor.lednice_room10_consumption` - Spotřeba po pokojích
- `sensor.lednice_owner_consumption` - Spotřeba majitelského pokoje (PIN 0000)

### Služby

#### `lednice.add_item` - Přidat položku

Přidá novou položku nebo zvýší počet existující položky.

```yaml
service: lednice.add_item
data:
  item_name: "Coca Cola"
  quantity: 10
  code: "8594001652419"
```

#### `lednice.remove_item` - Odebrat položku

Odebere položku z inventáře (s volitelným PIN).

```yaml
service: lednice.remove_item
data:
  item_name: "Coca Cola"
  quantity: 1
  pin: "1234"  # PIN pro room1
```

#### `lednice.update_item` - Aktualizovat položku

Aktualizuje počet nebo kód existující položky.

```yaml
service: lednice.update_item
data:
  item_name: "Coca Cola"
  quantity: 15
  code: "8594001652419"
```

#### `lednice.scan_code` - Naskenovat kód

Naskenuje čárový kód a automaticky odebere položku.

```yaml
service: lednice.scan_code
data:
  code: "8594001652419"
  pin: "1234"  # PIN pro identifikaci pokoje
```

#### `lednice.reset_inventory` - Resetovat inventář

Vymaže celý inventář a historii spotřeby.

```yaml
service: lednice.reset_inventory
```

#### `lednice.add_product_code` - Přidat produktový kód

Přidá nebo aktualizuje produktový kód s názvem, cenou a volitelným čárovým kódem.

```yaml
service: lednice.add_product_code
data:
  product_code: 1
  product_name: "Coca Cola 0.5L"
  price: 35.0
  code: "8594001652419"  # Volitelné
```

#### `lednice.remove_product_code` - Odebrat produktový kód

Odebere produktový kód z databáze.

```yaml
service: lednice.remove_product_code
data:
  product_code: 1
```

#### `lednice.consume_products` - Spotřebovat produkty

Spotřebuje více produktů najednou (používá self-service karta).

```yaml
service: lednice.consume_products
data:
  pin: "1234"
  products: [1, 2, 5, 1]  # Produkt 1 = 2x, produkt 2 = 1x, produkt 5 = 1x
```

## 🎯 Příklady použití

### Automatizace při skenování

```yaml
automation:
  - alias: "Lednice - Notifikace při skenování"
    trigger:
      - platform: event
        event_type: lednice_item_scanned
    action:
      - service: notify.mobile_app
        data:
          message: >
            {% if trigger.event.data.success %}
              {{ trigger.event.data.item }} odebrán z lednice ({{ trigger.event.data.room }})
            {% else %}
              Chyba: {{ trigger.event.data.reason }}
            {% endif %}
```

### Upozornění na nízký stav zásob

```yaml
automation:
  - alias: "Lednice - Upozornění na nízký stav"
    trigger:
      - platform: state
        entity_id: sensor.lednice_inventory
    condition:
      - condition: template
        value_template: >
          {% set low_items = state_attr('sensor.lednice_inventory', 'items_detail')
             | selectattr('quantity', 'le', 2) | list %}
          {{ low_items | length > 0 }}
    action:
      - service: notify.mobile_app
        data:
          message: >
            Nízký stav zásob v lednici:
            {% set low_items = state_attr('sensor.lednice_inventory', 'items_detail')
               | selectattr('quantity', 'le', 2) | list %}
            {% for item in low_items %}
            - {{ item.name }}: {{ item.quantity }} ks
            {% endfor %}
```

### Integrace s čtečkou čárových kódů (ESPHome)

```yaml
# V ESPHome konfiguraci
text_sensor:
  - platform: template
    name: "Barcode Scanner"
    id: barcode_input
    on_value:
      then:
        - homeassistant.service:
            service: lednice.scan_code
            data:
              code: !lambda 'return x;'
              pin: "1234"  # PIN pokoje
        - text_sensor.template.publish:
            id: barcode_input
            state: ""
```

### Panel pro správu inventáře

```yaml
type: vertical-stack
cards:
  - type: custom:lednice-card
    entity: sensor.lednice_inventory
    consumption_entity: sensor.lednice_consumption
    title: Lednice - Inventář

  - type: entities
    title: Rychlé akce
    entities:
      - type: button
        name: Přidat Coca Cola
        tap_action:
          action: call-service
          service: lednice.add_item
          data:
            item_name: "Coca Cola"
            quantity: 1
            code: "8594001652419"

      - type: button
        name: Přidat Red Bull
        tap_action:
          action: call-service
          service: lednice.add_item
          data:
            item_name: "Red Bull"
            quantity: 1
            code: "9002490100070"
```

## 📊 Dostupné atributy

### `sensor.lednice_inventory`

```yaml
inventory:
  "Coca Cola":
    quantity: 10
    code: "8594001652419"
    added: "2024-01-15T10:30:00"
  "Red Bull":
    quantity: 5
    code: "9002490100070"
    added: "2024-01-15T11:00:00"
total_items: 2
items_detail:
  - name: "Coca Cola"
    quantity: 10
    code: "8594001652419"
  - name: "Red Bull"
    quantity: 5
    code: "9002490100070"
product_codes:
  "1":
    name: "Coca Cola 0.5L"
    price: 35.0
    barcode: "8594001652419"
    code: 1
  "2":
    name: "Fanta 0.5L"
    price: 35.0
    barcode: ""
    code: 2
```

### `sensor.lednice_consumption`

```yaml
consumption_log:
  - item: "Coca Cola"
    quantity: 1
    room: "room1"
    price: 35.0
    timestamp: "2024-01-15T12:00:00"
total_consumed: 50
total_revenue: 1750.0  # Celkový příjem
room_statistics:
  room1: 20  # Počet kusů
  room2: 15
  room3: 10
room_prices:
  room1: 700.0  # Celková částka k úhradě
  room2: 525.0
  room3: 350.0
item_statistics:
  "Coca Cola": 30
  "Red Bull": 20
```

### `sensor.lednice_room1_consumption` (a další pokoje)

```yaml
room: "room1"
total_price: 700.0  # Částka k úhradě pro tento pokoj
item_statistics:
  "Coca Cola": 15
  "Red Bull": 5
recent_items:
  - item: "Coca Cola"
    quantity: 1
    room: "room1"
    price: 35.0
    timestamp: "2024-01-15T12:00:00"
pin_configured: true
```

## 🏨 Kompletní nastavení samoobslužné lednice v penzionu

### 1. Příprava obrázků produktů

```bash
# Vytvořte složku pro obrázky
mkdir -p /config/www/lednice/products/

# Umístěte obrázky:
# /config/www/lednice/products/1.png - Coca Cola
# /config/www/lednice/products/2.png - Fanta
# atd.
```

### 2. Nastavení produktových kódů

```yaml
# V Developer Tools → Services
service: lednice.add_product_code
data:
  product_code: 1
  product_name: "Coca Cola 0.5L"
  price: 35.0

service: lednice.add_product_code
data:
  product_code: 2
  product_name: "Fanta 0.5L"
  price: 35.0

# atd. pro všechny produkty...
```

### 3. Nastavení PINů pokojů

V **Nastavení** → **Zařízení a služby** → **Lednice** → **Konfigurovat**:
- room1: 1234
- room2: 5678
- atd.

### 4. Dashboard pro tablet

Vytvořte nový dashboard pro tablet s fullscreen kartou:

```yaml
type: custom:lednice-selfservice-card
entity: sensor.lednice_inventory
title: Samoobslužná lednice
```

### 5. Tablet konfigurace

Doporučené nastavení tabletu:
- **Kiosk Mode** - HACS addon pro fullscreen bez UI
- **Screen Wake Lock** - Obrazovka pořád zapnutá
- **Auto-refresh** - Automatické obnovení po chybě

### 6. Zobrazení spotřeby pokojů

Pro přehled v recepci:

```yaml
type: entities
title: Spotřeba po pokojích
entities:
  - entity: sensor.lednice_room1_consumption
    secondary_info: last-changed
    name: Pokoj 1
  - entity: sensor.lednice_room2_consumption
    name: Pokoj 2
  # atd.
```

Nebo použijte template kartu pro zobrazení částek:

```yaml
type: markdown
content: |
  ## Částky k úhradě

  {% for i in range(1, 11) %}
  **Pokoj {{ i }}**: {{ state_attr('sensor.lednice_room' ~ i ~ '_consumption', 'total_price') | float | round(2) }} Kč
  {% endfor %}

  **Celkem**: {{ state_attr('sensor.lednice_consumption', 'total_revenue') | float | round(2) }} Kč
```

## 🔧 Řešení problémů

### Integrace se nenačte

1. Zkontrolujte logy v **Nastavení** → **Systém** → **Logy**
2. Ujistěte se, že jste restartovali Home Assistant po instalaci
3. Ověřte, že složka je ve správné lokaci: `config/custom_components/lednice/`

### Karta se nezobrazuje

1. Zkontrolujte, že jste přidali zdroj v nastavení dashboardu
2. URL by měla být: `/local/lednice-card.js` a `/local/lednice-selfservice-card.js`
3. Zkontrolujte konzoli prohlížeče (F12) pro chyby

### Obrázky produktů se nezobrazují

1. Ujistěte se, že obrázky jsou ve správné složce: `/config/www/lednice/products/`
2. Soubory musí být pojmenovány: `1.png`, `2.png`, atd. (ne `01.png`)
3. Zkontrolujte oprávnění souborů (musí být čitelné)

### Data se neukládají

1. Zkontrolujte oprávnění pro zápis do složky `.storage`
2. Restartujte Home Assistant
3. Zkontrolujte logy pro chyby související s úložištěm

### PIN nefunguje

1. Zkontrolujte, že jste nastavili PIN v konfiguraci integrace
2. PIN musí být stejný jako v atributu senzoru room
3. Pro testování použijte PIN `0000` (majitelský pokoj)

## 🤝 Přispívání

Příspěvky jsou vítány! Pokud najdete chybu nebo máte nápad na vylepšení:

1. Otevřete issue na GitHubu
2. Vytvořte pull request
3. Kontaktujte autora

## 📄 Licence

MIT License

## 👨‍💻 Autor

**joshuaaaaa**

---

**Užijte si chytrou lednici! 🎉**
