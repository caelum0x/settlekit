=== SettleKit for WooCommerce ===
Tags: usdc, stablecoin, payments, crypto, woocommerce
Requires at least: 6.2
Tested up to: 6.8
Requires PHP: 8.0
Stable tag: 0.1.0
License: MIT
License URI: https://opensource.org/licenses/MIT

Accept USDC in WooCommerce. Funds go straight to your own wallet.

== Description ==

Buyers pick "USDC" at checkout, pay from their wallet on any network you accept in SettleKit, and come back to the order received page. SettleKit verifies the payment onchain and the order completes automatically.

* No custody: payments go to the receiving wallets in your SettleKit payment settings.
* Store currency must be USD (USDC settles 1:1).
* A buyer who returns to checkout reuses the same open payment.

== Installation ==

1. Upload the plugin folder to `wp-content/plugins/` and activate it.
2. In SettleKit: finish payment setup, create an API key, and add a webhook endpoint `https://YOUR-STORE/?wc-api=settlekit` subscribed to `invoice.paid`.
3. In WooCommerce > Settings > Payments > SettleKit (USDC): enable it and paste the API URL, API key and the webhook signing secret.

== Changelog ==

= 0.1.0 =
* First release.
