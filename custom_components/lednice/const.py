"""Constants for Lednice integration."""

DOMAIN = "lednice"
NAME = "Lednice"

# Configuration
CONF_ROOMS = "rooms"
CONF_ROOM_PINS = "room_pins"
CONF_PRODUCTS = "products"

# Services
SERVICE_ADD_ITEM = "add_item"
SERVICE_REMOVE_ITEM = "remove_item"
SERVICE_UPDATE_ITEM = "update_item"
SERVICE_SCAN_CODE = "scan_code"
SERVICE_RESET_INVENTORY = "reset_inventory"
SERVICE_ADD_PRODUCT_CODE = "add_product_code"
SERVICE_REMOVE_PRODUCT_CODE = "remove_product_code"
SERVICE_CONSUME_PRODUCTS = "consume_products"
SERVICE_VERIFY_PIN = "verify_pin"
SERVICE_CLEAR_ROOM_CONSUMPTION = "clear_room_consumption"

# Attributes
ATTR_ITEM_NAME = "item_name"
ATTR_QUANTITY = "quantity"
ATTR_CODE = "code"
ATTR_PIN = "pin"
ATTR_ROOM = "room"
ATTR_INVENTORY = "inventory"
ATTR_CONSUMPTION_LOG = "consumption_log"
ATTR_PRODUCT_CODE = "product_code"
ATTR_PRODUCT_NAME = "product_name"
ATTR_PRICE = "price"
ATTR_PRODUCTS = "products"
ATTR_TOTAL_PRICE = "total_price"
ATTR_HISTORY = "history"

# Default values
DEFAULT_ROOMS = ["room1", "room2", "room3", "room4", "room5", "room6", "room7", "room8", "room9", "room10"]
DEFAULT_OWNER_PIN = "0000"
OWNER_ROOM = "owner"

# Product codes range
MIN_PRODUCT_CODE = 1
MAX_PRODUCT_CODE = 100

# Storage
STORAGE_KEY = "lednice_storage"
STORAGE_VERSION = 1

# History
MAX_HISTORY_ENTRIES = 200

# Previo integration
PREVIO_DOMAIN = "previo_v4"
PREVIO_ATTR_ROOM = "room"
PREVIO_ATTR_CARD_KEYS = "card_keys"
PREVIO_ATTR_CHECKIN = "checkin"
PREVIO_ATTR_CHECKOUT = "checkout"
PREVIO_ATTR_GUEST = "guest"
