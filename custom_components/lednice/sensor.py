"""Sensor platform for Lednice."""
import logging
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, ATTR_INVENTORY, ATTR_CONSUMPTION_LOG

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Lednice sensors."""
    coordinator = hass.data[DOMAIN][entry.entry_id]

    sensors = [
        LedniceInventorySensor(coordinator, entry),
        LedniceConsumptionSensor(coordinator, entry),
    ]

    # Add per-room consumption sensors
    from .const import DEFAULT_ROOMS, OWNER_ROOM
    for room in DEFAULT_ROOMS:
        sensors.append(LedniceRoomConsumptionSensor(coordinator, entry, room))

    # Add owner room sensor
    sensors.append(LedniceRoomConsumptionSensor(coordinator, entry, OWNER_ROOM))

    async_add_entities(sensors)


class LedniceInventorySensor(SensorEntity):
    """Sensor for Lednice inventory."""

    def __init__(self, coordinator, entry: ConfigEntry):
        """Initialize the sensor."""
        self._coordinator = coordinator
        self._entry = entry
        self._attr_name = f"{entry.title} Inventory"
        self._attr_unique_id = f"{entry.entry_id}_inventory"
        self._attr_icon = "mdi:fridge"

    @property
    def state(self) -> int:
        """Return the total number of items."""
        return sum(item.get("quantity", 0) for item in self._coordinator.inventory.values())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the state attributes."""
        return {
            ATTR_INVENTORY: self._coordinator.inventory,
            "total_items": len(self._coordinator.inventory),
            "items_detail": [
                {
                    "name": name,
                    "quantity": data.get("quantity", 0),
                    "code": data.get("code", ""),
                }
                for name, data in self._coordinator.inventory.items()
            ],
            "product_codes": self._coordinator.product_codes,
            "room_pins": self._coordinator.room_pins,  # Show all static room PINs for admin
            "previo_pins": self._coordinator.data.get("previo_pins", {}),  # Show active Previo reservations with PINs
        }

    @property
    def available(self) -> bool:
        """Return True if entity is available."""
        return True

    async def async_added_to_hass(self):
        """When entity is added to hass."""
        self._coordinator.add_listener(self.async_write_ha_state)

    async def async_will_remove_from_hass(self):
        """When entity will be removed from hass."""
        self._coordinator.remove_listener(self.async_write_ha_state)


class LedniceConsumptionSensor(SensorEntity):
    """Sensor for Lednice consumption log."""

    def __init__(self, coordinator, entry: ConfigEntry):
        """Initialize the sensor."""
        self._coordinator = coordinator
        self._entry = entry
        self._attr_name = f"{entry.title} Consumption"
        self._attr_unique_id = f"{entry.entry_id}_consumption"
        self._attr_icon = "mdi:chart-line"

    @property
    def state(self) -> int:
        """Return the total number of consumption events."""
        return len(self._coordinator.consumption_log)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the state attributes."""
        # Get last 50 consumption events
        recent_log = self._coordinator.consumption_log[-50:] if self._coordinator.consumption_log else []

        # Calculate statistics
        room_stats = {}
        item_stats = {}
        room_prices = {}

        for log_entry in self._coordinator.consumption_log:
            room = log_entry.get("room", "Unknown")
            item = log_entry.get("item", "Unknown")
            quantity = log_entry.get("quantity", 1)
            price = log_entry.get("price", 0.0)

            # Room statistics (quantity)
            if room not in room_stats:
                room_stats[room] = 0
            room_stats[room] += quantity

            # Room prices (total cost)
            if room not in room_prices:
                room_prices[room] = 0.0
            room_prices[room] += price * quantity

            # Item statistics
            if item not in item_stats:
                item_stats[item] = 0
            item_stats[item] += quantity

        return {
            ATTR_CONSUMPTION_LOG: recent_log,
            "total_consumed": sum(log.get("quantity", 0) for log in self._coordinator.consumption_log),
            "total_revenue": sum(log.get("price", 0.0) * log.get("quantity", 1) for log in self._coordinator.consumption_log),
            "room_statistics": room_stats,
            "room_prices": room_prices,
            "item_statistics": item_stats,
        }

    @property
    def available(self) -> bool:
        """Return True if entity is available."""
        return True

    async def async_added_to_hass(self):
        """When entity is added to hass."""
        self._coordinator.add_listener(self.async_write_ha_state)

    async def async_will_remove_from_hass(self):
        """When entity will be removed from hass."""
        self._coordinator.remove_listener(self.async_write_ha_state)


class LedniceRoomConsumptionSensor(SensorEntity):
    """Sensor for per-room consumption."""

    def __init__(self, coordinator, entry: ConfigEntry, room: str):
        """Initialize the sensor."""
        self._coordinator = coordinator
        self._entry = entry
        self._room = room
        self._attr_name = f"{entry.title} {room} Consumption"
        self._attr_unique_id = f"{entry.entry_id}_{room}_consumption"
        self._attr_icon = "mdi:door"

    @property
    def state(self) -> int:
        """Return the total consumption for this room."""
        return sum(
            log.get("quantity", 0)
            for log in self._coordinator.consumption_log
            if log.get("room") == self._room
        )

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the state attributes."""
        # Filter logs for this room
        room_logs = [
            log for log in self._coordinator.consumption_log
            if log.get("room") == self._room
        ]

        # Get last 20 items
        recent_logs = room_logs[-20:] if room_logs else []

        # Calculate item statistics and total price for this room
        item_stats = {}
        total_price = 0.0

        for log_entry in room_logs:
            item = log_entry.get("item", "Unknown")
            quantity = log_entry.get("quantity", 1)
            price = log_entry.get("price", 0.0)

            if item not in item_stats:
                item_stats[item] = 0
            item_stats[item] += quantity

            total_price += price * quantity

        return {
            "room": self._room,
            "recent_items": recent_logs,
            "item_statistics": item_stats,
            "total_price": round(total_price, 2),
            "pin_configured": self._room in self._coordinator.room_pins,
            "pin": self._coordinator.room_pins.get(self._room, "Not configured"),  # Show PIN for this room
        }

    @property
    def available(self) -> bool:
        """Return True if entity is available."""
        return True

    async def async_added_to_hass(self):
        """When entity is added to hass."""
        self._coordinator.add_listener(self.async_write_ha_state)

    async def async_will_remove_from_hass(self):
        """When entity will be removed from hass."""
        self._coordinator.remove_listener(self.async_write_ha_state)
