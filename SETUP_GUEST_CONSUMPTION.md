# 🧾 Nastavení zobrazení konzumace pro hosty

Tento návod vám ukáže, jak nastavit funkční kartu pro zobrazení zakoupených věcí hostům.

## 📋 Co karta dělá:

✅ Zobrazuje zakoupené věci po přihlášení PINem
✅ Ukazuje celkovou cenu a počet položek
✅ Automaticky odhlásí po 5 minutách
✅ Vymaže data při odhlášení
✅ Zobrazí countdown timer do automatického odhlášení

---

## 🚀 Instalace - Krok za krokem

### 1️⃣ Zkopírujte package soubor

Zkopírujte soubor `zamek2.yaml` do složky `/config/packages/`:

```bash
mkdir -p /config/packages
cp zamek2.yaml /config/packages/zamek2.yaml
```

### 2️⃣ Aktivujte packages v configuration.yaml

Přidejte do `/config/configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

### 3️⃣ Restartujte Home Assistant

Po restartu se vytvoří tyto entity:
- `input_boolean.lednice_guest_logged_in` - Stav přihlášení
- `input_text.lednice_current_pin` - Aktuální PIN
- `input_text.lednice_last_pin_result` - Výsledek ověření (JSON)

A automatizace:
- **Automatizace 1:** Nastavení přihlášení po úspěšném PIN
- **Automatizace 2:** Vymazání dat při odhlášení
- **Automatizace 3:** Zpracování neplatného PIN
- **Automatizace 4:** Automatické odhlášení po 5 minutách

### 4️⃣ Přidejte Lovelace kartu

Zkopírujte obsah souboru `GUEST_CONSUMPTION_CARD.yaml` do vašeho dashboardu:

1. Otevřete Home Assistant
2. Jděte do dashboardu kde chcete kartu zobrazit
3. Klikněte na "Upravit dashboard"
4. Klikněte na "Přidat kartu"
5. Vyberte "Manuální" nebo "YAML"
6. Zkopírujte CELÝ obsah z `GUEST_CONSUMPTION_CARD.yaml`
7. Uložte

---

## 🔍 Jak to funguje

### Tok dat:

```
1. Host zadá PIN v lednice-selfservice-card.js
   ↓
2. Backend ověří PIN pomocí služby lednice.verify_pin
   ↓
3. Backend vyhodí událost lednice_pin_verified s daty
   ↓
4. Automatizace 1 zachytí událost a:
   - Zapne input_boolean.lednice_guest_logged_in
   - Uloží JSON data do input_text.lednice_last_pin_result
   ↓
5. Lovelace karta zobrazí data z input_text.lednice_last_pin_result
   ↓
6. Po 5 minutách se automaticky odhlásí (Automatizace 4)
   NEBO host klikne na "Odhlásit se"
   ↓
7. input_boolean.lednice_guest_logged_in se přepne na OFF
   ↓
8. Automatizace 2 vymaže všechna data
   ↓
9. Karta zobrazí přihlašovací obrazovku
```

### Struktura JSON dat v input_text.lednice_last_pin_result:

```json
{
  "valid": true,
  "room": "room3",
  "guest_name": "Jan Novák",
  "checkin": "2025-11-20",
  "checkout": "2025-11-25",
  "total_price": 350.0,
  "total_items": 12,
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
    }
  }
}
```

---

## 🧪 Testování

### Test 1: Přihlášení a zobrazení konzumace

1. Otevřete `lednice-selfservice-card.js` kartu
2. Zadejte platný PIN (např. `1234`)
3. Měli byste vidět produkty
4. Otevřete kartu konzumace
5. **Měli byste vidět:**
   - Jméno hosta
   - Číslo pokoje
   - Tabulku zakoupených položek
   - Celkovou cenu
   - Countdown timer

### Test 2: Odhlášení

1. Na kartě konzumace klikněte na "🚪 Odhlásit se"
2. **Měli byste vidět:**
   - Tlačítko odhlášení zmizí
   - Zobrazí se přihlašovací obrazovka
   - Data konzumace zmizí

### Test 3: Automatické odhlášení

1. Přihlaste se pomocí PIN
2. Počkejte 5 minut
3. **Mělo by se stát:**
   - Automaticky se odhlásíte
   - Data se vymažou
   - Zobrazí se přihlašovací obrazovka

---

## 🐛 Řešení problémů

### Problém: Karta se nezobrazuje správně

**Řešení:**
1. Zkontrolujte že máte `packages` aktivované v `configuration.yaml`
2. Restartujte Home Assistant
3. Zkontrolujte že automatizace jsou aktivní:
   - Jděte do Nastavení → Automatizace a scény
   - Měli byste vidět 4 automatizace začínající "Lednice -"

### Problém: Data se nezobrazují po přihlášení

**Řešení:**
1. Zkontrolujte stav entit v Developer Tools → States:
   - `input_boolean.lednice_guest_logged_in` by měl být `on`
   - `input_text.lednice_last_pin_result` by měl obsahovat JSON
2. Zkontrolujte logy:
   - Jděte do Nastavení → Systém → Protokoly
   - Hledejte chyby s "lednice"

### Problém: Data se nevymažou po odhlášení

**Řešení:**
1. Zkontrolujte že automatizace "Lednice - Vymazat data při odhlášení" je aktivní
2. Zkontrolujte trigger této automatizace - měl by být:
   ```yaml
   trigger:
     - platform: state
       entity_id: input_boolean.lednice_guest_logged_in
       to: "off"
   ```
3. Restartujte Home Assistant

### Problém: Časovač nezobrazuje správný čas

**Řešení:**
1. Ujistěte se že vaše časová zóna v Home Assistant je správně nastavená
2. Časovač se počítá od `last_changed` entity `input_boolean.lednice_guest_logged_in`

---

## 📝 Poznámky

- **Automatické odhlášení:** Nastaveno na 5 minut (můžete změnit v automatizaci 4)
- **Bezpečnost:** Data jsou vymazána při každém odhlášení
- **JSON validace:** Karta má vestavěnou ochranu proti nevalidním JSON datům
- **Countdown timer:** Zobrazuje zbývající čas do automatického odhlášení

---

## 🎨 Přizpůsobení

### Změna času automatického odhlášení:

V `zamek2.yaml`, automatizace 4, změňte:

```yaml
for:
  minutes: 5  # <-- změňte na požadovaný počet minut
```

### Změna textu na kartě:

Upravte `GUEST_CONSUMPTION_CARD.yaml` podle vašich potřeb.

---

## ✅ Hotovo!

Nyní máte plně funkční systém pro zobrazení konzumace hostům! 🎉
