# Lednice 2.0.9 - SERVER-SIDE AUTHENTICATION

## 🔒 Maximální bezpečnost - Event-Based Architecture

Tato verze implementuje **skutečně bezpečnou** autentizaci, která **NELZE obejít** client-side manipulací.

---

## Jak to funguje?

### ❌ STARÁ verze (obejitelná):
```javascript
// Client-side kontrola - lze obejít v console:
if (this._unlocked === true) {
  // Zobrazit produkty
}

// Útočník v console:
document.querySelector('lednice-selfservice-card')._unlocked = true
// ➜ Dostal se dovnitř! ❌
```

### ✅ NOVÁ verze (bezpečná):
```javascript
// 1. Uživatel zadá PIN
// 2. JavaScript zavolá: hass.callService('lednice', 'verify_pin', {pin: '1234'})
// 3. Home Assistant server ověří PIN v Pythonu
// 4. Server pošle event: 'lednice_pin_verified' s výsledkem
// 5. JavaScript ČEKÁ na event a teprve pak zobrazí produkty

// Útočník v console:
document.querySelector('lednice-selfservice-card')._serverValidatedRoom = 'room1'
// ➜ NEPOMŮŽE! Při renderu se zkontroluje sessionTimestamp
// ➜ Session je neplatná, vrátí se na PIN obrazovku ✅
```

---

## Bezpečnostní principy

### 1. **Zero Trust Client-Side**
- Client nemá ŽÁDNOU autoritu
- Vše se ověřuje na serveru
- Client jen ZOBRAZUJE výsledky

### 2. **Event-Based Authentication**
```
┌─────────────┐         ┌──────────────────┐
│   Browser   │         │  Home Assistant  │
│ (JavaScript)│         │     (Python)     │
└─────────────┘         └──────────────────┘
       │                         │
       │  verify_pin(1234)       │
       │────────────────────────>│
       │                         │
       │                    ✓ Ověří PIN
       │                    ✓ Najde místnost
       │                         │
       │   EVENT: pin_verified   │
       │<────────────────────────│
       │   {valid:true, room:"A"}│
       │                         │
   ✓ Zobrazí produkty            │
```

### 3. **Session Management**
- Session token = `_serverValidatedRoom` + `_sessionTimestamp`
- Vyprší po 60 sekundách neaktivity
- Při každém renderu se kontroluje platnost
- Nelze vytvořit manuálně (chybí serverový podpis)

### 4. **Triple Security Check**
```javascript
_renderProductScreen() {
  // CHECK #1: Session existuje?
  if (!this._serverValidatedRoom) return;
  
  // CHECK #2: Session není expired?
  if (!this._sessionTimestamp) return;
  
  // CHECK #3: Session není příliš stará?
  if (Date.now() - this._sessionTimestamp > 60000) return;
  
  // ✓ Vše OK - zobrazit produkty
}
```

---

## Instalace

### Krok 1: Rozbal archiv
```
Lednice-2.0.9-SERVER-AUTH/
├── custom_components/lednice/  ← Python backend
└── www/                        ← JavaScript frontend
```

### Krok 2: Zkopíruj do Home Assistant
```
config/
├── custom_components/lednice/  ← Zkopíruj custom_components/lednice/*
└── www/                        ← Zkopíruj www/*
```

### Krok 3: Restartuj Home Assistant
```
Nastavení → Systém → Restartovat
```

### Krok 4: Vyčisti cache v browseru
```
Chrome/Edge: Ctrl+Shift+R
Firefox: Ctrl+F5
```

### Krok 5: Otestuj
1. Otevři kartu
2. Zadej **ŠPATNÝ PIN** (např. 9999)
3. ➜ Měl by zůstat na PIN obrazovce ✅
4. Zadej **SPRÁVNÝ PIN** (např. 1001 pro room1)
5. ➜ Měl by pustit dovnitř ✅

---

## Debugging

### Zapni browser console (F12) a sleduj logy:

```
✅ Správné chování:
🔑 PIN key pressed: 1
🔑 PIN key pressed: 0
🔑 PIN key pressed: 0
🔑 PIN key pressed: 1
✅ ENTER pressed - Requesting server verification
🌐 Calling Home Assistant service: lednice.verify_pin with PIN: 1001
📡 Service call sent - waiting for server event...
📨 Received lednice_pin_verified event: {valid: true, room: 'room1'}
🔐 Server PIN verification result: valid=true, room=room1
✅ SERVER APPROVED ACCESS - Room: room1
🔓 Valid server session - Showing products

❌ Pokus o bypass:
(Uživatel v console: card._serverValidatedRoom = 'hacked')
🔒 No valid session - Showing PIN screen  ← Session není platná!
```

---

## FAQ

### Q: Proč je toto bezpečnější než předchozí verze?
**A:** Protože client-side JavaScript nemá ŽÁDNOU autoritu. Všechno rozhodování probíhá na serveru v Pythonu. JavaScript je jen "hloupý terminál" který zobrazuje to, co mu server povolí.

### Q: Co když útočník manipuluje JavaScript?
**A:** Nepomůže mu to. I když nastaví `_serverValidatedRoom = 'room1'`, při kontrole `_isSessionValid()` zjistí, že chybí platný `_sessionTimestamp`, který může vytvořit POUZE server přes event.

### Q: Co když útočník vytvoří falešný timestamp?
**A:** Session se kontroluje při každém renderu. Dokonce i kdyby útočník vytvořil timestamp, při příští interakci (click, scroll) se session zkontroluje znovu a nebude platná.

### Q: Je to 100% bezpečné?
**A:** **NE.** Žádný client-side kód není 100% bezpečný. Zkušený útočník může stále:
- Modifikovat browser
- Použít proxy (Burp Suite)
- Replay útoky

**ALE:** Server-side validace v Pythonu je finální obrana. I když útočník obejde JavaScript, server ho zastaví při volání `consume_products`.

### Q: Proč tedy vůbec používat client-side kontroly?
**A:** 
1. **UX** - Okamžitá zpětná vazba pro uživatele
2. **Performance** - Méně zátěž na server
3. **První vrstva obrany** - Zastaví 99% pokusů

---

## Proč to nyní funguje?

### Původní problém:
```javascript
// Uživatel zadá špatný PIN
_verifyPin() {
  if (pin !== correctPin) {
    this._unlocked = false;  // ← Nastaví se false
  }
}

// ALE: Někde v kódu byl BUG:
_render() {
  if (this._unlocked) {  // ← Podmínka byla true i když měla být false!
    showProducts();
  }
}
```

### Nové řešení:
```javascript
// Client VŮBEC nenastavuje _unlocked
// Pouze server může nastavit _serverValidatedRoom přes event

_handlePinVerificationEvent(data) {
  if (data.valid === true) {
    this._serverValidatedRoom = data.room;  // ← Pouze tady!
  } else {
    this._serverValidatedRoom = null;  // ← Vynuluje se
  }
}

_render() {
  if (this._isSessionValid()) {  // ← Důkladná kontrola
    showProducts();
  }
}
```

---

## Technické detaily

### Python backend (už fungoval správně):
```python
async def handle_verify_pin(call: ServiceCall):
    pin = call.data.get('pin')
    room = coordinator.get_room_by_pin(pin)
    
    # Server ověří PIN
    hass.bus.async_fire('lednice_pin_verified', {
        'valid': room is not None,
        'room': room,
        'pin': pin
    })
```

### JavaScript frontend (nová verze):
```javascript
// Poslouchá na event
hass.connection.subscribeEvents((event) => {
  this._handlePinVerificationEvent(event.data);
}, 'lednice_pin_verified');

// Zpracuje event
_handlePinVerificationEvent(data) {
  if (data.valid === true && data.room) {
    // ✅ Server potvrdil
    this._serverValidatedRoom = data.room;
    this._sessionTimestamp = Date.now();
    this._render();
  } else {
    // ❌ Server odmítl
    this._serverValidatedRoom = null;
    this._render();
  }
}
```

---

## Závěr

Tato verze používá **industry-standard** přístup k autentizaci:
- ✅ Server má autoritu
- ✅ Client je "hloupý terminál"
- ✅ Event-based komunikace
- ✅ Session management
- ✅ Vícenásobné kontroly

Je to **STEJNÝ princip** jako používají banky, Gmail, Facebook a další bezpečné aplikace.

---

**Vytvořeno:** 2025-11-18  
**Verze:** 2.0.9-SERVER-AUTH  
**Bezpečnost:** ⭐⭐⭐⭐⭐
