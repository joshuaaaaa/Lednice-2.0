# RYCHLÁ INSTALACE - Lednice 2.0.9

## 3 jednoduché kroky:

### 1. Zkopíruj soubory
```
custom_components/lednice/  →  config/custom_components/lednice/
www/*                       →  config/www/
```

### 2. Restartuj HA
```
Nastavení → Systém → Restartovat
```

### 3. Vyčisti cache
```
Ctrl+Shift+R (Chrome/Edge)
Ctrl+F5 (Firefox)
```

---

## Test:
1. Zadej **špatný PIN** → zůstane na PIN obrazovce ✅
2. Zadej **správný PIN** → pustí dovnitř ✅

---

## Co je nového?

### ⚡ SERVER-SIDE AUTHENTICATION
- PIN se ověřuje na Home Assistant serveru (Python)
- JavaScript čeká na potvrzení od serveru
- **NELZE obejít** client-side manipulací

### 🔒 Bezpečnostní vylepšení:
- Event-based architecture
- Session management s timeoutem
- Triple security check
- Zero trust client-side

---

## Debugging:

Otevři browser console (F12) a sleduj:
```
✅ Správný PIN:
📨 Received lednice_pin_verified event: {valid: true, room: 'room1'}
🔓 Valid server session - Showing products

❌ Špatný PIN:
📨 Received lednice_pin_verified event: {valid: false}
🔒 No valid session - Showing PIN screen
```

---

## Problém?

Zkontroluj:
1. Python backend správně nainstalován?
2. Cache vyčištěna?
3. Verze karty v console: `2.0.9-SERVER-AUTH`
4. Events fungují? (Developer Tools → Events → Listen to `lednice_pin_verified`)

---

**Více info:** Přečti si README_SECURITY.md pro úplné vysvětlení
