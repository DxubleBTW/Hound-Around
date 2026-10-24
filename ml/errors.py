"""Recognition failures shared with the API without importing model weights."""


class UnrecognizedLocation(ValueError):
    """The best match is below the configured recognition threshold."""
