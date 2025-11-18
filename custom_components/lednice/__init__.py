"""Lednice - Fridge Inventory Manager Integration."""
import logging
from datetime import datetime
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.storage import Store

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
        "product_codes": {}  # Maps product code (1-100) to {name, price, barcode}
    }

    # Ensure product_codes exists (for migration from v1)
    if "product_codes" not in data:
        data["product_codes"] = {}

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

    # Setup platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register services
    await async_setup_services(hass, coordinator)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
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

        # Fire event with verification result - ENSURE room is None if invalid
        response = {
            "pin": pin,
            "valid": is_valid,
            "room": room if is_valid else None
        }
        _LOGGER.warning(f"🔔 Firing event lednice_pin_verified with data: {response}")
        hass.bus.async_fire(f"{DOMAIN}_pin_verified", response)

        # Return response data directly to the service caller
        return response

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
        supports_response=SupportsResponse.ONLY
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
        """Get room name by PIN."""
        for room, room_pin in self.room_pins.items():
            if room_pin == pin:
                return room
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

        await self._save_data()
        self._notify_listeners()
        return True

    async def update_item(self, item_name: str, quantity: int | None = None, code: str | None = None) -> None:
        """Update item in inventory."""
        if item_name not in self.inventory:
            self.inventory[item_name] = {
                "quantity": 0,
                "code": "",
                "added": datetime.now().isoformat()
            }

        if quantity is not None:
            self.inventory[item_name]["quantity"] = quantity
        if code is not None:
            self.inventory[item_name]["code"] = code

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
        await self._save_data()
        self._notify_listeners()

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
