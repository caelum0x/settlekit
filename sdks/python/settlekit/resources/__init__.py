"""Resource namespaces for the SettleKit SDK.

Each module exports a synchronous class and an asynchronous (``Async``-prefixed)
counterpart. The client wires one instance of each onto its public attributes.
"""

from __future__ import annotations

from .agent_services import AgentServices, AsyncAgentServices
from .analytics import Analytics, AsyncAnalytics
from .api_keys import ApiKeys, AsyncApiKeys
from .checkout import AsyncCheckoutSessions, CheckoutSessions
from .coupons import AsyncCoupons, Coupons
from .customers import AsyncCustomers, Customers
from .disputes import AsyncDisputes, Disputes
from .dunning import AsyncDunning, Dunning
from .entitlements import AsyncEntitlements, Entitlements
from .invoices import AsyncInvoices, Invoices
from .license_keys import AsyncLicenseKeys, LicenseKeys
from .marketplace import AsyncMarketplace, Marketplace
from .payments import AsyncPayments, Payments
from .payouts import AsyncPayouts, Payouts
from .prices import AsyncPrices, Prices
from .products import AsyncProducts, Products
from .refunds import AsyncRefunds, Refunds
from .settings import AsyncSettings, Settings
from .subscriptions import AsyncSubscriptions, Subscriptions
from .usage import AsyncUsage, Usage
from .webhooks import AsyncWebhooks, Webhooks

__all__ = [
    "Products",
    "AsyncProducts",
    "Prices",
    "AsyncPrices",
    "Customers",
    "AsyncCustomers",
    "CheckoutSessions",
    "AsyncCheckoutSessions",
    "Payments",
    "AsyncPayments",
    "Entitlements",
    "AsyncEntitlements",
    "LicenseKeys",
    "AsyncLicenseKeys",
    "ApiKeys",
    "AsyncApiKeys",
    "Coupons",
    "AsyncCoupons",
    "Usage",
    "AsyncUsage",
    "Analytics",
    "AsyncAnalytics",
    "Invoices",
    "AsyncInvoices",
    "Refunds",
    "AsyncRefunds",
    "Subscriptions",
    "AsyncSubscriptions",
    "Disputes",
    "AsyncDisputes",
    "Dunning",
    "AsyncDunning",
    "Settings",
    "AsyncSettings",
    "Payouts",
    "AsyncPayouts",
    "AgentServices",
    "AsyncAgentServices",
    "Marketplace",
    "AsyncMarketplace",
    "Webhooks",
    "AsyncWebhooks",
]
