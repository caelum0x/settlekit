"""Exception types raised by the SettleKit SDK.

The SettleKit API serializes every failure as the envelope
``{"error": {"code": str, "message": str, "details"?: dict}}`` carried by a
non-2xx HTTP status. :class:`SettleKitError` mirrors that shape so callers can
branch on the stable machine-readable ``code`` and inspect the originating
``status``.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

__all__ = [
    "SettleKitError",
    "SettleKitConfigError",
    "SettleKitConnectionError",
]


class SettleKitError(Exception):
    """Raised when the SettleKit API responds with a non-2xx status.

    Attributes:
        code: Stable machine-readable error code (e.g. ``"not_found"``,
            ``"validation_error"``, ``"unauthorized"``, ``"conflict"``,
            ``"internal_error"``).
        message: Human-readable explanation of the failure.
        status: The HTTP status code that accompanied the error (``0`` when the
            error did not originate from an HTTP response).
        details: Optional structured context attached by the server.
    """

    def __init__(
        self,
        code: str,
        message: str,
        status: int = 0,
        details: Optional[Mapping[str, Any]] = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status = status
        self.details = dict(details) if details else None
        super().__init__(self.__str__())

    def __str__(self) -> str:
        if self.status:
            return f"settlekit: {self.message} (code={self.code}, status={self.status})"
        return f"settlekit: {self.message} (code={self.code})"

    def __repr__(self) -> str:
        return (
            f"SettleKitError(code={self.code!r}, message={self.message!r}, "
            f"status={self.status!r}, details={self.details!r})"
        )


class SettleKitConfigError(SettleKitError):
    """Raised when the SDK is misconfigured (e.g. a missing API key)."""

    def __init__(self, message: str) -> None:
        super().__init__(code="config_error", message=message, status=0)


class SettleKitConnectionError(SettleKitError):
    """Raised when the request never reached the API (network/transport error)."""

    def __init__(self, message: str) -> None:
        super().__init__(code="connection_error", message=message, status=0)
