# 📦 Instalace Lednice 2.0 - Kompletní průvodce

## 🎯 Co tento balíček obsahuje

- **zamek2.yaml** - Kompletní konfigurace (input helpers + automatizace)
- **LOVELACE_CARD_EXAMPLE.yaml** - Připravená karta pro dashboard
- **custom_components/lednice/** - Hlavní integrace Lednice

---

## 📋 Instalace krok za krokem

### KROK 1: Povolte packages v configuration.yaml

Otevřete `/config/configuration.yaml` a přidejte (pokud tam ještě není):

```yaml
homeassistant:
  packages: !include_dir_named packages
```

### KROK 2: Vytvořte složku packages

Vytvořte složku `/config/packages/` pokud neexistuje:

```bash
mkdir -p /config/packages
```

### KROK 3: Zkopírujte zamek2.yaml

Zkopírujte soubor `zamek2.yaml` do složky packages:

```bash
cp zamek2.yaml /config/packages/
```

**NEBO** ručně zkopírujte obsah souboru `zamek2.yaml` do `/config/packages/zamek2.yaml`

### KROK 4: Zkopírujte Lednice integraci

Zkopírujte celou složku `custom_components/lednice/` do vaší Home Assistant konfigurace:

```bash
cp -r custom_components/lednice /config/custom_components/
```

**Pokud máte starou verzi Lednice, přepište ji!**

### KROK 5: Restartujte Home Assistant

1. Jděte do **Nastavení → Systém → Restart**
2. Klikněte na **RESTARTOVAT**
3. Počkejte 1-2 minuty na restart

### KROK 6: Ověřte, že entity existují

Po restartu jděte do **Vývojářské nástroje → Stavy** a vyhledejte:

- ✅ `input_boolean.lednice_guest_logged_in`
- ✅ `input_text.lednice_current_pin`
- ✅ `input_text.lednice_last_pin_result`

Pokud entity nejsou vidět, zkontrolujte **Nastavení → Systém → Logy** pro chybové zprávy.

### KROK 7: Ověřte automatizace

Jděte do **Nastavení → Automatizace a scény** a ověřte, že existují:

- ✅ "Lednice - Nastavit přihlášení po PIN"
- ✅ "Lednice - Vymazat data při odhlášení"
- ✅ "Lednice - Neplatný PIN"

### KROK 8: Přidejte Lovelace kartu

1. Otevřete váš dashboard
2. Klikněte na **Upravit dashboard**
3. Klikněte na **+ PŘIDAT KARTU**
4. Vyberte **Ruční karta** (Manual card)
5. Zkopírujte obsah z `LOVELACE_CARD_EXAMPLE.yaml`
6. Vložte do editoru
7. Klikněte **ULOŽIT**

---

## ✅ Testování

### Test 1: Přihlášení

1. Zadejte platný PIN na klávesnici
2. Měla by se zobrazit karta s konzumací
3. `input_boolean.lednice_guest_logged_in` by měl být **ON**

### Test 2: Odhlášení

1. Klikněte na tlačítko "🚪 Odhlásit se"
2. Karta by se měla změnit na "🔐 Zadejte PIN"
3. `input_boolean.lednice_guest_logged_in` by měl být **OFF**
4. Data by měla být vymazána

### Test 3: Neplatný PIN

1. Zadejte neplatný PIN
2. Měla by se zobrazit zpráva "❌ Neplatný PIN"
3. Boolean by měl zůstat **OFF**

---

## 🔧 Řešení problémů

### Entity se nevytvořily

**Příčina:** Packages nejsou povoleny nebo špatná cesta

**Řešení:**
1. Zkontrolujte `configuration.yaml` - musí obsahovat `packages: !include_dir_named packages`
2. Ověřte, že soubor je v `/config/packages/zamek2.yaml`
3. Zkontrolujte logy: **Nastavení → Systém → Logy**

### Tlačítko "Odhlásit se" nefunguje

**Příčina:** Entity neexistuje nebo špatná konfigurace karty

**Řešení:**
1. Ověřte, že `input_boolean.lednice_guest_logged_in` existuje
2. Zkuste použít debug kartu z `LOVELACE_CARD_EXAMPLE.yaml` (odkomentujte debug sekci)
3. Sledujte, zda se boolean přepíná po kliknutí

### Data se nevymazávají při odhlášení

**Příčina:** Automatizace není aktivní

**Řešení:**
1. Jděte do **Nastavení → Automatizace a scény**
2. Najděte "Lednice - Vymazat data při odhlášení"
3. Zkontrolujte, že je **ZAPNUTÁ** (modrý přepínač)
4. Klikněte na automatizaci a zkuste **SPUSTIT** ručně

### Chyba při parsování datumu

**Příčina:** Previo používá nestandardní formát data

**Řešení:**
1. Ověřte, že máte nejnovější verzi Lednice integrace
2. Zkontrolujte soubor `custom_components/lednice/__init__.py`
3. Měl by obsahovat metodu `_parse_date()` s podporou formátu `"%B %d, %Y at %I:%M:%S %p"`

### Event lednice_pin_verified se nevyvolává

**Příčina:** Verze Lednice nepodporuje event systém

**Řešení:**
1. Zkontrolujte, že máte aktuální verzi z tohoto repozitáře
2. V souboru `custom_components/lednice/__init__.py` vyhledejte:
   ```python
   self.hass.bus.fire("lednice_pin_verified", event_data)
   ```
3. Pokud tento řádek chybí, zkopírujte aktuální verzi integrace

---

## 📚 Struktura souborů

```
/config/
├── configuration.yaml          # Musí obsahovat: packages: !include_dir_named packages
├── packages/
│   └── zamek2.yaml            # ← Hlavní konfigurace (input helpers + automatizace)
└── custom_components/
    └── lednice/
        ├── __init__.py        # ← Hlavní logika integrace
        ├── const.py           # ← Konstanty
        ├── manifest.json
        └── sensor.py          # ← Senzory (inventory, history)
```

---

## 🎨 Přizpůsobení

### Změna doby expirace PINů

V `custom_components/lednice/__init__.py` najděte:

```python
expiry_threshold = now - timedelta(hours=1)
```

Změňte `hours=1` na požadovanou hodnotu (např. `hours=2` pro 2 hodiny).

### Změna intervalu čištění

V `custom_components/lednice/__init__.py` najděte:

```python
async_track_time_interval(self.hass, cleanup_task, timedelta(minutes=30))
```

Změňte `minutes=30` na požadovaný interval.

### Přizpůsobení vzhledu karty

Upravte `LOVELACE_CARD_EXAMPLE.yaml` podle vašich potřeb:
- Změňte ikony (např. `mdi:logout` → `mdi:door-open`)
- Upravte barvy pomocí CSS (vyžaduje card-mod)
- Změňte formát data (např. `[:10]` zobrazí pouze datum bez času)

---

## 🆘 Podpora

Pokud máte problémy:

1. **Zkontrolujte logy:** Nastavení → Systém → Logy
2. **Ověřte entity:** Vývojářské nástroje → Stavy
3. **Testujte automatizace:** Nastavení → Automatizace → Spustit ručně
4. **Použijte debug kartu:** Odkomentujte debug sekci v Lovelace kartě

---

## 📝 Changelog

### Verze 2.0 (2025-11-21)

✨ **Nové funkce:**
- Integrace s Previo v4 (dynamické PINy z rezervací)
- Automatické čištění expirovaných PINů (1h po checkout)
- Historie inventáře (200 záznamů)
- HTML dashboard pro aktivní rezervace
- Zobrazení konzumace hosta při přihlášení
- Jediné tlačítko pro odhlášení (vymaže data + odhlásí)

🐛 **Opravy:**
- Fix parsování data z Previo (formát "November 24, 2025 at 10:00:00 AM")
- Fix metody `clear_room_consumption` (async_save → _save_data)

🎨 **Vylepšení:**
- Moderní glassmorphism design dashboardu
- Automatické obnovení každých 30 sekund
- Statistiky (aktivní pokoje, hosté, celkový příjem)

---

## 🚀 Co dál?

Po úspěšné instalaci můžete:

- 📊 Přidat **HTML dashboard** - viz `www/lednice-reservations.html`
- 🔔 Nastavit **notifikace** při konzumaci
- 📱 Vytvořit **mobilní view** s optimalizovaným layoutem
- 🎨 Přizpůsobit **téma** pomocí card-mod
- 📈 Přidat **grafy** spotřeby pomocí apex-charts

Další nápady najdete v `FUTURE_IMPROVEMENTS.md`! 🎯
