"""Lednice - Fridge Inventory Manager Integration."""
import logging
from datetime import datetime, timedelta
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse, State, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.storage import Store
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval

from .const import (
    DOMAIN,
    SERVICE_ADD_ITEM,
    SERVICE_REMOVE_ITEM,
    SERVICE_UPDATE_ITEM,
    SERVICE_SCAN_CODE,
    SERVICE_RESET_INVENTORY,
    SERVICE_ADD_PRODUCT_CODE,
    SERVICE_REMOVE_PRODUCT_CODE,
    SERVICE_CONSUME_PRODUCTS,
    SERVICE_VERIFY_PIN,
    SERVICE_CLEAR_ROOM_CONSUMPTION,
    ATTR_ITEM_NAME,
    ATTR_QUANTITY,
    ATTR_CODE,
    ATTR_PIN,
    ATTR_ROOM,
    ATTR_PRODUCT_CODE,
    ATTR_PRODUCT_NAME,
    ATTR_PRICE,
    ATTR_PRODUCTS,
    STORAGE_KEY,
    STORAGE_VERSION,
    DEFAULT_OWNER_PIN,
    OWNER_ROOM,
    MAX_HISTORY_ENTRIES,
    PREVIO_DOMAIN,
    PREVIO_ATTR_ROOM,
    PREVIO_ATTR_CARD_KEYS,
    PREVIO_ATTR_CHECKIN,
    PREVIO_ATTR_CHECKOUT,
    PREVIO_ATTR_GUEST,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR]


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Lednice component."""
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Lednice from a config entry."""

    # Initialize storage
    store = Store(
        hass,
        STORAGE_VERSION,
        f"{STORAGE_KEY}_{entry.entry_id}"
    )
    data = await store.async_load() or {
        "inventory": {},
        "room_pins": {OWNER_ROOM: DEFAULT_OWNER_PIN},  # Default owner PIN
        "consumption_log": [],
        "product_codes": {},  # Maps product code (1-100) to {name, price, barcode}
        "history": []  # Complete history of all operations
    }

    # Ensure product_codes exists (for migration from v1)
    if "product_codes" not in data:
        data["product_codes"] = {}

    # Ensure history exists (for migration)
    if "history" not in data:
        data["history"] = []

    # Ensure owner PIN exists
    if OWNER_ROOM not in data.get("room_pins", {}):
        data.setdefault("room_pins", {})[OWNER_ROOM] = DEFAULT_OWNER_PIN

    # Initialize permanent PINs for all rooms (room1 = 1001, room2 = 1002, etc.)
    from .const import DEFAULT_ROOMS
    for i, room in enumerate(DEFAULT_ROOMS, start=1):
        if room not in data.get("room_pins", {}):
            # Generate PIN: room1 -> 1001, room2 -> 1002, etc.
            pin = f"{1000 + i:04d}"
            data.setdefault("room_pins", {})[room] = pin
            _LOGGER.info(f"Initialized PIN for {room}: {pin}")

    # Store coordinator in hass.data
    coordinator = LedniceDataCoordinator(hass, store, data, entry)
    hass.data[DOMAIN][entry.entry_id] = coordinator

    # Setup Previo sensor monitoring
    await coordinator.setup_previo_monitoring()

    # Setup platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register services
    await async_setup_services(hass, coordinator)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        # Remove Previo listeners
        coordinator = hass.data[DOMAIN].get(entry.entry_id)
        if coordinator and hasattr(coordinator, '_previo_listeners'):
            for listener in coordinator._previo_listeners:
                listener()
            coordinator._previo_listeners.clear()

        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok


async def async_setup_services(hass: HomeAssistant, coordinator: "LedniceDataCoordinator") -> None:
    """Set up services for Lednice."""

    def get_coordinator() -> "LedniceDataCoordinator":
        """Get the first available coordinator."""
        coordinators = hass.data.get(DOMAIN, {})
        if coordinators:
            return next(iter(coordinators.values()))
        return None

    async def handle_add_item(call: ServiceCall) -> None:
        """Handle add item service."""
        coord = get_coordinator()
        if not coord:
            _LOGGER.error("No Lednice coordinator found")
            return

        item_name = call.data.get(ATTR_ITEM_NAME)
        quantity = call.data.get(ATTR_QUANTITY, 1)
        code = call.data.get(ATTR_CODE, "")

        await coord.add_item(item_name, quantity, code)
        _LOGGER.info(f"Added {quantity}x {item_name} to inventory")

    async def handle_remove_item(call: ServiceCall) -> None:
        """Handle remove item service."""
        coord = get_coordinator()
        if not coord:
            _LOGGER.error("No Lednice coordinator found")
            return

        item_name = call.data.get(ATTR_ITEM_NAME)
        quantity = call.data.get(ATTR_QUANTITY, 1)
        pin = call.data.get(ATTR_PIN)

        room = coord.get_room_by_pin(pin) if pin else None
        # Get price from inventory item if available
        price = coord.inventory.get(item_name, {}).get("price", 0.0)
        success = await coord.remove_item(item_name, quantity, room, price)

        if success:
            _LOGGER.info(f"Removed {quantity}x {item_name} from inventory (Room: {room})")
        else:
            _LOGGER.warning(f"Failed to remove {item_name} - insufficient quantity")

    async def handle_update_item(call: ServiceCall) -> None:
        """Handle update item service."""
        coord = get_coordinator()
        if not coord:
            _LOGGER.error("No Lednice coordinator found")
            return

        item_name = call.data.get(ATTR_ITEM_NAME)
        quantity = call.data.get(ATTR_QUANTITY)
        code = call.data.get(ATTR_CODE)

        await coord.update_item(item_name, quantity, code)
        _LOGGER.info(f"Updated {item_name} to quantity {quantity}")

    async def handle_scan_code(call: ServiceCall) -> None:
        """Handle barcode scan service."""
        coord = get_coordinator()
        if not coord:
            _LOGGER.error("No Lednice coordinator found")
            return

        code = call.data.get(ATTR_CODE)
        pin = call.data.get(ATTR_PIN)

        room = coord.get_room_by_pin(pin) if pin else None
        item_name = coord.get_item_by_code(code)

        if item_name:
            # Get price from inventory item if available
            price = coord.inventory.get(item_name, {}).get("price", 0.0)
            success = await coord.remove_item(item_name, 1, room, price)
            if success:
                _LOGGER.info(f"Scanned code {code} - removed {item_name} (Room: {room})")
                hass.bus.async_fire(f"{DOMAIN}_item_scanned", {
                    "item": item_name,
                    "code": code,
                    "room": room,
                    "success": True
                })
            else:
                _LOGGER.warning(f"Scanned code {code} but {item_name} is out of stock")
                hass.bus.async_fire(f"{DOMAIN}_item_scanned", {
                    "item": item_name,
                    "code": code,
                    "room": room,
                    "success": False,
                    "reason": "out_of_stock"
                })
        else:
            _LOGGER.warning(f"Unknown code scanned: {code}")
            hass.bus.async_fire(f"{DOMAIN}_item_scanned", {
                "code": code,
                "room": room,
                "success": False,
                "reason": "unknown_code"
            })

    async def handle_reset_inventory(call: ServiceCall) -> None:
        """Handle reset inventory service."""
        coord = get_coordinator()
        if not coord:
            _LOGGER.error("No Lednice coordinator found")
            return

        await coord.reset_inventory()
        _LOGGER.info("Inventory reset")

    async def handle_add_product_code(call: ServiceCall) -> None:
        """Handle add product code service."""
        coord = get_coordinator()
        if not coord:
            _LOGGER.error("No Lednice coordinator found")
            return

        product_code = call.data.get(ATTR_PRODUCT_CODE)
        product_name = call.data.get(ATTR_PRODUCT_NAME)
        price = call.data.get(ATTR_PRICE, 0.0)
        barcode = call.data.get(ATTR_CODE, "")

        await coord.add_product_code(product_code, product_name, price, barcode)
        _LOGGER.info(f"Added product code {product_code}: {product_name} (${price})")

    async def handle_remove_product_code(call: ServiceCall) -> None:
        """Handle remove product code service."""
        coord = get_coordinator()
        if not coord:
            _LOGGER.error("No Lednice coordinator found")
            return

        product_code = call.data.get(ATTR_PRODUCT_CODE)

        await coord.remove_product_code(product_code)
        _LOGGER.info(f"Removed product code {product_code}")

    async def handle_consume_products(call: ServiceCall) -> None:
        """Handle consume products service (for self-service)."""
        coord = get_coordinator()
        if not coord:
            _LOGGER.error("No Lednice coordinator found")
            return

        pin = call.data.get(ATTR_PIN)
        products = call.data.get(ATTR_PRODUCTS, [])  # List of product codes

        room = coord.get_room_by_pin(pin) if pin else None
        if not room:
            _LOGGER.warning(f"Invalid PIN: {pin}")
            hass.bus.async_fire(f"{DOMAIN}_consume_failed", {
                "reason": "invalid_pin",
                "pin": pin
            })
            return

        # Process each product
        success_count = 0
        failed_products = []

        for product_code in products:
            product_info = coord.get_product_by_code(product_code)
            if not product_info:
                _LOGGER.warning(f"Unknown product code: {product_code}")
                failed_products.append(product_code)
                continue

            # Try to remove from inventory
            item_name = product_info.get("name", f"Product {product_code}")
            price = product_info.get("price", 0.0)

            success = await coord.remove_item(item_name, 1, room, price)
            if success:
                success_count += 1
            else:
                failed_products.append(product_code)

        _LOGGER.info(f"Consumed {success_count} products for room {room}")
        hass.bus.async_fire(f"{DOMAIN}_products_consumed", {
            "room": room,
            "success_count": success_count,
            "failed_products": failed_products
        })

    async def handle_verify_pin(call: ServiceCall) -> dict:
        """Handle verify PIN service (for self-service)."""
        coord = get_coordinator()
        if not coord:
            _LOGGER.error("No Lednice coordinator found")
            return {
                "valid": False,
                "room": None,
                "error": "No coordinator found"
            }

        pin = call.data.get(ATTR_PIN)

        # Validate PIN exists and is not empty
        if not pin:
            _LOGGER.warning("🔐 PIN verification FAILED: Empty PIN provided")
            response = {
                "pin": "",
                "valid": False,
                "room": None
            }
            hass.bus.async_fire(f"{DOMAIN}_pin_verified", response)
            return response

        room = coord.get_room_by_pin(pin)

        # Log verification attempt for debugging (using WARNING to ensure visibility)
        is_valid = room is not None
        _LOGGER.warning(
            f"🔐 PIN verification: PIN='{pin}' | Room='{room}' | Valid={is_valid} | "
            f"Available PINs={dict(coord.room_pins)}"
        )

        # Prepare response with consumption data
        response = {
            "pin": pin,
            "valid": is_valid,
            "room": room if is_valid else None
        }

        # If valid, add consumption information
        if is_valid and room:
            # Get guest info from Previo if available
            previo_pins = coord.data.get("previo_pins", {})
            _LOGGER.warning(f"🔍 Looking for guest info: room={room}, pin={pin}")
            _LOGGER.warning(f"🔍 Available previo_pins keys: {list(previo_pins.keys())}")

            # Search for matching room AND pin in new structure (room{X}_{PIN})
            guest_info = {}
            for entry_key, pin_data in previo_pins.items():
                if pin_data.get("room") == room and pin_data.get("pin") == pin:
                    guest_info = pin_data
                    _LOGGER.warning(f"✅ Found guest info in {entry_key}: {guest_info}")
                    break

            if not guest_info:
                _LOGGER.warning(f"⚠️ No Previo guest info found for room={room}, pin={pin} (this is OK for static PINs)")

            guest_name = guest_info.get("guest")
            checkin = guest_info.get("checkin")
            checkout = guest_info.get("checkout")

            # Calculate consumption for this room
            room_logs = [
                log for log in coord.consumption_log
                if log.get("room") == room
            ]

            # Calculate total price
            total_price = sum(
                log.get("price", 0.0) * log.get("quantity", 1)
                for log in room_logs
            )

            # Group items by name with quantities and prices
            item_summary = {}
            for log in room_logs:
                item = log.get("item", "Unknown")
                quantity = log.get("quantity", 1)
                price = log.get("price", 0.0)

                if item not in item_summary:
                    item_summary[item] = {
                        "quantity": 0,
                        "unit_price": price,
                        "total_price": 0.0
                    }

                item_summary[item]["quantity"] += quantity
                item_summary[item]["total_price"] += price * quantity

            # Add consumption data to response
            response.update({
                "guest_name": guest_name,
                "checkin": checkin,
                "checkout": checkout,
                "total_price": round(total_price, 2),
                "total_items": sum(log.get("quantity", 1) for log in room_logs),
                "item_summary": item_summary,
                "consumption_count": len(room_logs)
            })

            _LOGGER.warning(
                f"💰 Room {room} consumption: {total_price:.2f} Kč | "
                f"Guest: {guest_name or 'N/A'} | Items: {len(item_summary)} | "
                f"item_summary: {item_summary}"
            )

        _LOGGER.warning(f"🔔 Firing event lednice_pin_verified with data: {response}")
        hass.bus.async_fire(f"{DOMAIN}_pin_verified", response)

        # Return response data directly to the service caller
        return response

    async def handle_clear_room_consumption(call: ServiceCall) -> None:
        """Handle clear room consumption service."""
        coord = get_coordinator()
        if not coord:
            _LOGGER.error("No Lednice coordinator found")
            return

        room = call.data.get(ATTR_ROOM)

        # Remove all consumption log entries for this room
        original_count = len(coord.data.get("consumption_log", []))
        coord.data["consumption_log"] = [
            entry for entry in coord.data.get("consumption_log", [])
            if entry.get("room") != room
        ]
        removed_count = original_count - len(coord.data["consumption_log"])

        await coord._save_data()
        coord._notify_listeners()

        _LOGGER.info(f"Cleared {removed_count} consumption entries for room '{room}'")

    # Register services
    hass.services.async_register(
        DOMAIN,
        SERVICE_ADD_ITEM,
        handle_add_item,
        schema=vol.Schema({
            vol.Required(ATTR_ITEM_NAME): cv.string,
            vol.Optional(ATTR_QUANTITY, default=1): cv.positive_int,
            vol.Optional(ATTR_CODE, default=""): cv.string,
        })
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_REMOVE_ITEM,
        handle_remove_item,
        schema=vol.Schema({
            vol.Required(ATTR_ITEM_NAME): cv.string,
            vol.Optional(ATTR_QUANTITY, default=1): cv.positive_int,
            vol.Optional(ATTR_PIN): cv.string,
        })
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_UPDATE_ITEM,
        handle_update_item,
        schema=vol.Schema({
            vol.Required(ATTR_ITEM_NAME): cv.string,
            vol.Required(ATTR_QUANTITY): cv.positive_int,
            vol.Optional(ATTR_CODE): cv.string,
        })
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_SCAN_CODE,
        handle_scan_code,
        schema=vol.Schema({
            vol.Required(ATTR_CODE): cv.string,
            vol.Optional(ATTR_PIN): cv.string,
        })
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_RESET_INVENTORY,
        handle_reset_inventory,
        schema=vol.Schema({})
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_ADD_PRODUCT_CODE,
        handle_add_product_code,
        schema=vol.Schema({
            vol.Required(ATTR_PRODUCT_CODE): cv.positive_int,
            vol.Required(ATTR_PRODUCT_NAME): cv.string,
            vol.Optional(ATTR_PRICE, default=0.0): vol.Coerce(float),
            vol.Optional(ATTR_CODE, default=""): cv.string,
        })
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_REMOVE_PRODUCT_CODE,
        handle_remove_product_code,
        schema=vol.Schema({
            vol.Required(ATTR_PRODUCT_CODE): cv.positive_int,
        })
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_CONSUME_PRODUCTS,
        handle_consume_products,
        schema=vol.Schema({
            vol.Required(ATTR_PIN): cv.string,
            vol.Required(ATTR_PRODUCTS): [cv.positive_int],
        })
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_VERIFY_PIN,
        handle_verify_pin,
        schema=vol.Schema({
            vol.Required(ATTR_PIN): cv.string,
        }),
        supports_response=SupportsResponse.OPTIONAL
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_CLEAR_ROOM_CONSUMPTION,
        handle_clear_room_consumption,
        schema=vol.Schema({
            vol.Required(ATTR_ROOM): cv.string,
        })
    )


class LedniceDataCoordinator:
    """Class to manage Lednice data."""

    def __init__(self, hass: HomeAssistant, store: Store, data: dict, entry: ConfigEntry):
        """Initialize the coordinator."""
        self.hass = hass
        self.store = store
        self.data = data
        self.entry = entry
        self._listeners = []
        self._previo_listeners = []

    @staticmethod
    def _parse_date(date_input) -> datetime | None:
        """Parse date from various formats (ISO, Previo format, etc.) or return datetime object."""
        if not date_input:
            return None

        # If already a datetime object, return it
        if isinstance(date_input, datetime):
            return date_input

        # If not a string, convert to string
        if not isinstance(date_input, str):
            date_string = str(date_input)
        else:
            date_string = date_input

        # List of formats to try
        formats = [
            "%Y-%m-%d",  # 2025-11-24
            "%Y-%m-%dT%H:%M:%S",  # 2025-11-24T10:00:00
            "%Y-%m-%d %H:%M:%S",  # 2025-11-24 10:00:00
            "%B %d, %Y at %I:%M:%S %p",  # November 24, 2025 at 10:00:00 AM
            "%B %d, %Y",  # November 24, 2025
        ]

        # Try ISO format first (fastest)
        try:
            return datetime.fromisoformat(date_string)
        except (ValueError, AttributeError, TypeError):
            pass

        # Try other formats
        for fmt in formats:
            try:
                return datetime.strptime(date_string, fmt)
            except (ValueError, AttributeError, TypeError):
                continue

        # If all fails, log warning and return None
        _LOGGER.warning(f"Could not parse date: {date_input} (type: {type(date_input)})")
        return None

    @property
    def inventory(self) -> dict:
        """Return inventory."""
        return self.data.get("inventory", {})

    @property
    def room_pins(self) -> dict:
        """Return room PINs."""
        return self.data.get("room_pins", {})

    @property
    def consumption_log(self) -> list:
        """Return consumption log."""
        return self.data.get("consumption_log", [])

    @property
    def product_codes(self) -> dict:
        """Return product codes mapping."""
        return self.data.get("product_codes", {})

    def get_room_by_pin(self, pin: str) -> str | None:
        """Get room name by PIN, checking Previo pins first (with validity), then previo input_text, then fallback to static pins."""
        # First check Previo pins with validity
        previo_pins = self.data.get("previo_pins", {})
        current_time = datetime.now()

        _LOGGER.warning(f"🔍 PIN CHECK: Checking PIN '{pin}' against {len(previo_pins)} Previo reservations")
        _LOGGER.warning(f"🔍 Current time: {current_time}")
        _LOGGER.warning(f"🔍 Available Previo entries: {[(key, data.get('pin'), data.get('room')) for key, data in previo_pins.items()]}")

        # First: Check if PIN matches directly in previo_pins
        # Note: Keys are now in format "room{X}_{PIN}" to support multiple reservations per room
        for entry_key, pin_data in previo_pins.items():
            stored_pin = pin_data.get("pin")
            room = pin_data.get("room")

            if stored_pin == pin:
                _LOGGER.warning(f"🔍 PIN MATCH FOUND in previo_pins: {entry_key} has PIN '{pin}' for {room}")
                return self._validate_previo_pin_time(room, pin, pin_data, current_time)

        # Second: Check input_text.previo_used_pins_simple_X entities as fallback
        _LOGGER.warning(f"🔍 PIN not found in previo_pins, checking input_text entities...")
        for room_num in range(1, 11):
            input_text_entity = f"input_text.previo_used_pins_simple_{room_num}"
            state = self.hass.states.get(input_text_entity)
            if state and state.state and state.state == pin:
                room = f"room{room_num}"
                _LOGGER.warning(f"✅ PIN found in {input_text_entity}, matched to {room}")

                # Search previo_pins for matching room AND pin (keys are now room{X}_{PIN})
                matching_pin_data = None
                for entry_key, pin_data in previo_pins.items():
                    if pin_data.get("room") == room and pin_data.get("pin") == pin:
                        matching_pin_data = pin_data
                        _LOGGER.warning(f"🔍 Found matching Previo reservation: {entry_key}, validating time")
                        break

                if matching_pin_data:
                    return self._validate_previo_pin_time(room, pin, matching_pin_data, current_time)
                else:
                    # No Previo data, accept PIN from input_text without time validation
                    _LOGGER.warning(f"✅ Accepting PIN from input_text (no time validation)")
                    return room

        # Third: Fallback to static room PINs
        _LOGGER.warning(f"🔍 Checking static PINs: {dict(self.room_pins)}")
        for room, room_pin in self.room_pins.items():
            if room_pin == pin:
                _LOGGER.warning(f"✅ Static PIN verified: room={room}, pin={pin}")
                return room

        _LOGGER.warning(f"❌ PIN '{pin}' not found in any Previo or static PINs")
        return None

    def _validate_previo_pin_time(self, room: str, pin: str, pin_data: dict, current_time: datetime) -> str | None:
        """Validate if Previo PIN is within valid time range."""
        checkin_str = pin_data.get("checkin", "")
        checkout_str = pin_data.get("checkout", "")

        _LOGGER.warning(f"🔍 RAW DATES for {room}: checkin_str='{checkin_str}', checkout_str='{checkout_str}'")

        checkin_dt = self._parse_date(checkin_str)
        checkout_dt = self._parse_date(checkout_str)

        _LOGGER.warning(f"🔍 PARSED DATES for {room}: checkin_dt={checkin_dt}, checkout_dt={checkout_dt}")

        if not checkin_dt or not checkout_dt:
            _LOGGER.warning(f"❌ Could not parse dates for room {room}, rejecting PIN")
            _LOGGER.warning(f"❌ Failed to parse: checkin='{checkin_str}' or checkout='{checkout_str}'")
            return None

        _LOGGER.warning(
            f"🔍 TIME CHECK for {room}: checkin={checkin_dt}, checkout={checkout_dt}, current={current_time}"
        )
        _LOGGER.warning(f"🔍 COMPARISON: {checkin_dt} <= {current_time} <= {checkout_dt}?")

        # PIN is valid if current time is between checkin and checkout (inclusive)
        if checkin_dt <= current_time <= checkout_dt:
            _LOGGER.warning(
                f"✅ Previo PIN VERIFIED: room={room}, pin={pin}, guest={pin_data.get('guest')}, "
                f"valid from {checkin_dt} to {checkout_dt}"
            )
            return room
        else:
            _LOGGER.warning(
                f"❌ Previo PIN TIME MISMATCH: room={room}, pin={pin}, "
                f"valid from {checkin_dt} to {checkout_dt}, current={current_time}"
            )
            if current_time < checkin_dt:
                _LOGGER.warning(f"❌ Too early - checkin not reached yet!")
            if current_time > checkout_dt:
                _LOGGER.warning(f"❌ Too late - checkout time passed!")
            return None

    def get_item_by_code(self, code: str) -> str | None:
        """Get item name by barcode."""
        for item_name, item_data in self.inventory.items():
            if item_data.get("code") == code:
                return item_name
        return None

    def get_product_by_code(self, product_code: int) -> dict | None:
        """Get product info by product code (1-100)."""
        return self.product_codes.get(str(product_code))

    async def add_item(self, item_name: str, quantity: int, code: str = "") -> None:
        """Add item to inventory."""
        if item_name in self.inventory:
            self.inventory[item_name]["quantity"] += quantity
            if code:
                self.inventory[item_name]["code"] = code
        else:
            self.inventory[item_name] = {
                "quantity": quantity,
                "code": code,
                "added": datetime.now().isoformat()
            }

        # Log to history
        details = f"Code: {code}" if code else "No code"
        self._log_history("add", item_name, quantity, "owner", details)

        await self._save_data()
        self._notify_listeners()

    async def remove_item(self, item_name: str, quantity: int, room: str | None = None, price: float = 0.0) -> bool:
        """Remove item from inventory."""
        if item_name not in self.inventory:
            return False

        current_qty = self.inventory[item_name]["quantity"]
        if current_qty < quantity:
            return False

        self.inventory[item_name]["quantity"] -= quantity

        # Log consumption
        self.data["consumption_log"].append({
            "item": item_name,
            "quantity": quantity,
            "room": room,
            "price": price,
            "timestamp": datetime.now().isoformat()
        })

        # Keep only last 1000 logs
        if len(self.data["consumption_log"]) > 1000:
            self.data["consumption_log"] = self.data["consumption_log"][-1000:]

        # Log to history
        details = f"Price: {price} Kč" if price > 0 else "No price"
        self._log_history("remove", item_name, quantity, room, details)

        await self._save_data()
        self._notify_listeners()
        return True

    async def update_item(self, item_name: str, quantity: int | None = None, code: str | None = None) -> None:
        """Update item in inventory."""
        old_quantity = 0
        if item_name not in self.inventory:
            self.inventory[item_name] = {
                "quantity": 0,
                "code": "",
                "added": datetime.now().isoformat()
            }
        else:
            old_quantity = self.inventory[item_name].get("quantity", 0)

        details_parts = []
        if quantity is not None:
            self.inventory[item_name]["quantity"] = quantity
            details_parts.append(f"Qty: {old_quantity} → {quantity}")
        if code is not None:
            self.inventory[item_name]["code"] = code
            details_parts.append(f"Code: {code}")

        # Log to history
        details = ", ".join(details_parts) if details_parts else "Updated"
        qty_change = (quantity - old_quantity) if quantity is not None else 0
        self._log_history("update", item_name, qty_change, "owner", details)

        await self._save_data()
        self._notify_listeners()

    async def set_room_pin(self, room: str, pin: str) -> None:
        """Set PIN for a room."""
        self.data["room_pins"][room] = pin
        await self._save_data()
        self._notify_listeners()

    async def add_product_code(self, product_code: int, name: str, price: float = 0.0, barcode: str = "") -> None:
        """Add or update a product code mapping."""
        self.data["product_codes"][str(product_code)] = {
            "name": name,
            "price": price,
            "barcode": barcode,
            "code": product_code
        }
        await self._save_data()
        self._notify_listeners()

    async def remove_product_code(self, product_code: int) -> None:
        """Remove a product code mapping."""
        code_str = str(product_code)
        if code_str in self.data["product_codes"]:
            del self.data["product_codes"][code_str]
            await self._save_data()
            self._notify_listeners()

    async def reset_inventory(self) -> None:
        """Reset entire inventory."""
        self.data["inventory"] = {}
        self.data["consumption_log"] = []
        self._log_history("reset", "all", 0, "owner", "Inventory reset")
        await self._save_data()
        self._notify_listeners()

    def _log_history(self, action: str, item: str, quantity: int, room: str | None = None, details: str = "") -> None:
        """Log an action to history."""
        # Get guest name from Previo if available
        guest = None
        if room and room.startswith("room"):
            previo_pins = self.data.get("previo_pins", {})
            if room in previo_pins:
                guest = previo_pins[room].get("guest")

        entry = {
            "timestamp": datetime.now().isoformat(),
            "action": action,  # add, remove, update, reset
            "item": item,
            "quantity": quantity,
            "room": room,
            "guest": guest,
            "details": details
        }

        # Add to history
        if "history" not in self.data:
            self.data["history"] = []

        self.data["history"].append(entry)

        # Keep only last MAX_HISTORY_ENTRIES
        if len(self.data["history"]) > MAX_HISTORY_ENTRIES:
            self.data["history"] = self.data["history"][-MAX_HISTORY_ENTRIES:]

        _LOGGER.debug(f"📝 History logged: {action} | {item} | qty={quantity} | room={room} | guest={guest}")

    async def _save_data(self) -> None:
        """Save data to storage."""
        await self.store.async_save(self.data)

    def add_listener(self, listener) -> None:
        """Add a listener for data updates."""
        self._listeners.append(listener)

    def remove_listener(self, listener) -> None:
        """Remove a listener."""
        if listener in self._listeners:
            self._listeners.remove(listener)

    def _notify_listeners(self) -> None:
        """Notify all listeners of data update."""
        for listener in self._listeners:
            listener()

    async def setup_previo_monitoring(self) -> None:
        """Set up monitoring of Previo sensors."""
        # Initialize previo_pins if not exists
        if "previo_pins" not in self.data:
            self.data["previo_pins"] = {}

        # Get all Previo sensors
        _LOGGER.info("🔍 Setting up Previo sensor monitoring...")

        # Track all sensor state changes for previo_v4 domain
        @callback
        def previo_state_change_listener(event):
            """Handle Previo sensor state changes."""
            entity_id = event.data.get("entity_id")
            new_state = event.data.get("new_state")

            if not entity_id or not new_state:
                return

            # Only process previo_v4 sensors
            if not entity_id.startswith(f"sensor.{PREVIO_DOMAIN}"):
                return

            self.hass.async_create_task(self._handle_previo_state_change(entity_id, new_state))

        # Subscribe to all state changes
        self._previo_listeners.append(
            self.hass.bus.async_listen("state_changed", previo_state_change_listener)
        )

        # Initial extraction from all current Previo sensors
        await self._extract_all_previo_pins()

        # Set up periodic cleanup of expired PINs (every 30 minutes)
        @callback
        def cleanup_expired_pins(now):
            """Periodic cleanup of expired PINs."""
            self.hass.async_create_task(self._cleanup_expired_previo_pins())

        self._previo_listeners.append(
            async_track_time_interval(
                self.hass,
                cleanup_expired_pins,
                timedelta(minutes=30)
            )
        )

        # Run initial cleanup
        await self._cleanup_expired_previo_pins()

        _LOGGER.info("✅ Previo sensor monitoring set up successfully")

    async def _handle_previo_state_change(self, entity_id: str, new_state: State) -> None:
        """Handle a Previo sensor state change."""
        if new_state is None or new_state.state in ["unavailable", "unknown"]:
            return

        # Extract PIN from this sensor
        await self._extract_previo_pins_from_sensor(entity_id, new_state)

    async def _extract_all_previo_pins(self) -> None:
        """Extract PINs from all current Previo sensors."""
        _LOGGER.warning("🔍 Extracting PINs from all Previo sensors...")
        _LOGGER.warning(f"🔍 Looking for sensors starting with: sensor.{PREVIO_DOMAIN}")

        # Get all sensor entities
        all_sensors = self.hass.states.async_all("sensor")
        _LOGGER.warning(f"🔍 Total sensors in system: {len(list(all_sensors))}")

        previo_sensors = []
        for state in self.hass.states.async_all("sensor"):
            if state.entity_id.startswith(f"sensor.{PREVIO_DOMAIN}"):
                previo_sensors.append(state.entity_id)
                _LOGGER.warning(f"🔍 Found Previo sensor: {state.entity_id}")
                await self._extract_previo_pins_from_sensor(state.entity_id, state)

        if not previo_sensors:
            _LOGGER.warning(f"⚠️ No Previo sensors found! Looking for: sensor.{PREVIO_DOMAIN}_*")
            # Show first 20 sensor names for debugging
            sample_sensors = [s.entity_id for s in list(self.hass.states.async_all("sensor"))[:20]]
            _LOGGER.warning(f"🔍 Sample of available sensors: {sample_sensors}")

        await self._save_data()
        self._notify_listeners()

        _LOGGER.warning(f"✅ Previo PIN extraction complete. Found {len(previo_sensors)} Previo sensors, {len(self.data.get('previo_pins', {}))} active reservations")

    async def _extract_previo_pins_from_sensor(self, entity_id: str, state: State) -> None:
        """Extract PINs from a single Previo sensor."""
        _LOGGER.warning(f"🔍 Processing Previo sensor: {entity_id}")

        if not state or not state.attributes:
            _LOGGER.warning(f"⚠️ Sensor {entity_id} has no state or attributes")
            return

        # Show all attributes for debugging
        _LOGGER.warning(f"🔍 Sensor {entity_id} attributes: {dict(state.attributes)}")

        # Get room attribute
        room_attr = state.attributes.get(PREVIO_ATTR_ROOM)
        _LOGGER.warning(f"🔍 Room attribute: {room_attr}")
        if not room_attr:
            _LOGGER.warning(f"⚠️ Sensor {entity_id} missing '{PREVIO_ATTR_ROOM}' attribute")
            return

        # Parse room number(s) - can be string like "1" or "1, 2" for multiple rooms
        room_str = str(room_attr)
        room_numbers = [r.strip() for r in room_str.split(",")]
        _LOGGER.warning(f"🔍 Parsed room numbers: {room_numbers}")

        # Get card_keys attribute
        card_keys = state.attributes.get(PREVIO_ATTR_CARD_KEYS)
        _LOGGER.warning(f"🔍 card_keys attribute: {card_keys}")

        if not card_keys or not isinstance(card_keys, list):
            # Try single card_key as fallback
            single_key = state.attributes.get("card_key")
            _LOGGER.warning(f"🔍 Trying fallback card_key attribute: {single_key}")
            if single_key:
                card_keys = [single_key]
            else:
                _LOGGER.warning(f"⚠️ Sensor {entity_id} missing both 'card_keys' and 'card_key' attributes")
                return

        _LOGGER.warning(f"🔍 Final card_keys to use: {card_keys}")

        # Get checkin/checkout dates (could be string or datetime object)
        checkin_raw = state.attributes.get(PREVIO_ATTR_CHECKIN)
        checkout_raw = state.attributes.get(PREVIO_ATTR_CHECKOUT)
        guest = state.attributes.get(PREVIO_ATTR_GUEST, "Unknown")

        _LOGGER.warning(f"🔍 Checkin (raw): {checkin_raw} (type: {type(checkin_raw)})")
        _LOGGER.warning(f"🔍 Checkout (raw): {checkout_raw} (type: {type(checkout_raw)})")
        _LOGGER.warning(f"🔍 Guest: {guest}")

        if not checkin_raw or not checkout_raw:
            _LOGGER.warning(f"⚠️ Previo sensor {entity_id} missing checkin/checkout dates")
            return

        # Convert to ISO string if datetime object (for consistent storage)
        if isinstance(checkin_raw, datetime):
            checkin = checkin_raw.isoformat()
        else:
            checkin = str(checkin_raw) if checkin_raw else None

        if isinstance(checkout_raw, datetime):
            checkout = checkout_raw.isoformat()
        else:
            checkout = str(checkout_raw) if checkout_raw else None

        _LOGGER.warning(f"🔍 Converted - Checkin: {checkin}, Checkout: {checkout}")

        # Map each room number (1-10) to corresponding PIN from card_keys
        for i, room_num in enumerate(room_numbers):
            try:
                # Validate room number is 1-10
                room_int = int(room_num)
                if not 1 <= room_int <= 10:
                    _LOGGER.warning(f"Previo sensor {entity_id} has invalid room number: {room_num}")
                    continue

                # Get corresponding PIN (if exists)
                _LOGGER.warning(f"🔍 Processing room {room_num} (index {i})")
                if i < len(card_keys):
                    pin = str(card_keys[i]).strip()
                    _LOGGER.warning(f"🔍 Extracted PIN for room {room_num}: '{pin}'")
                    if not pin:
                        _LOGGER.warning(f"⚠️ PIN is empty for room {room_num}")
                        continue

                    # Store in previo_pins with combined key room_PIN to support multiple reservations per room
                    room_key = f"room{room_int}_{pin}"
                    self.data["previo_pins"][room_key] = {
                        "room": f"room{room_int}",
                        "pin": pin,
                        "checkin": checkin,
                        "checkout": checkout,
                        "guest": guest,
                        "sensor": entity_id
                    }

                    _LOGGER.warning(
                        f"✅ Previo PIN STORED: {room_key} -> PIN={pin}, "
                        f"guest={guest}, valid {checkin} to {checkout}"
                    )
                else:
                    _LOGGER.warning(f"⚠️ No card_key available for room {room_num} at index {i}")

            except (ValueError, IndexError) as err:
                _LOGGER.error(f"Error processing room {room_num} from {entity_id}: {err}")

        # Save and notify after processing
        await self._save_data()
        self._notify_listeners()

    async def _cleanup_expired_previo_pins(self) -> None:
        """Remove Previo PINs that are expired (1 hour after checkout)."""
        if "previo_pins" not in self.data:
            return

        current_time = datetime.now()
        expired_rooms = []

        for room, pin_data in self.data["previo_pins"].items():
            checkout_str = pin_data.get("checkout")
            if not checkout_str:
                continue

            # Parse checkout datetime
            checkout_dt = self._parse_date(checkout_str)

            if not checkout_dt:
                _LOGGER.warning(f"Could not parse checkout date for {room}: {checkout_str}")
                continue

            # Check if more than 1 hour past checkout
            time_since_checkout = current_time - checkout_dt
            if time_since_checkout > timedelta(hours=1):
                expired_rooms.append(room)
                _LOGGER.info(
                    f"🗑️ Removing expired Previo PIN: {room} | "
                    f"guest={pin_data.get('guest')} | "
                    f"checkout={checkout_str} | "
                    f"expired {time_since_checkout.total_seconds() / 3600:.1f}h ago"
                )

        # Remove expired PINs
        if expired_rooms:
            for room in expired_rooms:
                del self.data["previo_pins"][room]

            await self._save_data()
            self._notify_listeners()

            _LOGGER.info(f"✅ Cleaned up {len(expired_rooms)} expired Previo PIN(s)")
