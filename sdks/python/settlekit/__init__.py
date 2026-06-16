"""SettleKit — official Python SDK.

Crypto-native commerce, entitlements, license keys, and x402 paid APIs.

Quick start::

    from settlekit import SettleKit

    sk = SettleKit(api_key="sk_live_...")  # or set SETTLEKIT_API_KEY
    product = sk.products.create(
        merchant_id="m_1",
        organization_id="org_1",
        name="Pro Plan",
        type="digital",
        delivery_mode="license_key",
    )

Async::

    from settlekit import AsyncSettleKit

    async with AsyncSettleKit() as sk:
        products = await sk.products.list()

x402 paid endpoints::

    from settlekit.x402 import require_payment, install_x402_exception_handler
"""

from __future__ import annotations

from .client import AsyncSettleKit, SettleKit
from .errors import (
    SettleKitConfigError,
    SettleKitConnectionError,
    SettleKitError,
)
from .verify import (
    WEBHOOK_SIGNATURE_HEADER,
    verify_api_key,
    verify_entitlement,
    verify_license,
    verify_webhook_signature,
)

__version__ = "0.1.0"

__all__ = [
    "SettleKit",
    "AsyncSettleKit",
    "SettleKitError",
    "SettleKitConfigError",
    "SettleKitConnectionError",
    "verify_license",
    "verify_api_key",
    "verify_entitlement",
    "verify_webhook_signature",
    "WEBHOOK_SIGNATURE_HEADER",
    "__version__",
]
