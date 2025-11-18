"""Config flow for Lednice integration."""
import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
import homeassistant.helpers.config_validation as cv

from .const import DOMAIN, DEFAULT_ROOMS

_LOGGER = logging.getLogger(__name__)


class LedniceConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Lednice."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors = {}

        if user_input is not None:
            await self.async_set_unique_id(user_input.get("name", "lednice"))
            self._abort_if_unique_id_configured()

            return self.async_create_entry(
                title=user_input.get("name", "Lednice"),
                data=user_input,
            )

        data_schema = vol.Schema({
            vol.Optional("name", default="Lednice"): cv.string,
        })

        return self.async_show_form(
            step_id="user",
            data_schema=data_schema,
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        """Get the options flow for this handler."""
        return LedniceOptionsFlow(config_entry)


class LedniceOptionsFlow(config_entries.OptionsFlow):
    """Handle options flow for Lednice."""

    def __init__(self, config_entry):
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        # Get coordinator
        coordinator = self.hass.data[DOMAIN][self.config_entry.entry_id]

        # Build room PIN schema
        room_pins_schema = {}
        for room in DEFAULT_ROOMS:
            current_pin = coordinator.room_pins.get(room, "")
            room_pins_schema[vol.Optional(f"pin_{room}", default=current_pin)] = cv.string

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(room_pins_schema),
        )

    async def async_step_save(self, user_input):
        """Save the options."""
        coordinator = self.hass.data[DOMAIN][self.config_entry.entry_id]

        # Update room PINs
        for room in DEFAULT_ROOMS:
            pin_key = f"pin_{room}"
            if pin_key in user_input and user_input[pin_key]:
                await coordinator.set_room_pin(room, user_input[pin_key])

        return self.async_create_entry(title="", data=user_input)
