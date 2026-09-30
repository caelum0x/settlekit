# SettleKit for WooCommerce

A WooCommerce payment gateway that charges orders in USDC through SettleKit payment requests. Ported from [btcpayserver/woocommerce-greenfield-plugin](https://github.com/btcpayserver/woocommerce-greenfield-plugin) (MIT); see `settlekit-for-woocommerce/NOTICE`.

- Checkout creates a payment request for the order total (`POST /v1/invoices/requests`, no email, `successUrl` = order received page) and redirects to the hosted pay page.
- The signed `invoice.paid` webhook (`https://STORE/?wc-api=settlekit`) completes the order after checking the invoice id and amount. The order received page also checks the status, so a late webhook never leaves a paid order pending.
- Only offered for USD-priced stores (USDC settles 1:1).

## Package

```bash
cd plugins/woocommerce && zip -r settlekit-for-woocommerce.zip settlekit-for-woocommerce -x '*/tests/*'
```

Upload the zip in WordPress under Plugins > Add New > Upload.

## Tests

```bash
php plugins/woocommerce/settlekit-for-woocommerce/tests/run.php
```

`packages/webhooks/test/woocommerce-plugin.test.ts` runs the same suite from vitest and checks the PHP signature verifier against `@settlekit/webhooks` (skipped without a PHP CLI).
