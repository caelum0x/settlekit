# Open source used by SettleKit

Every third-party project SettleKit depends on, vendors, or models a feature on for the parity work (branch `parity/2026-09-30`). Licences were checked on 2026-09-30.

| Project | Licence | How it is used | Where |
|---------|---------|----------------|-------|
| [foliojs/pdfkit](https://github.com/foliojs/pdfkit) 0.17.2 | MIT | npm dependency (not vendored). Renders invoice and receipt PDFs. | `packages/invoices/src/pdf.ts` |
| [btcpayserver/btcpayserver](https://github.com/btcpayserver/btcpayserver) | MIT | Design reference only, no code copied. The invoice / payment request lifecycle (issue, public pay page, expiring payment attempts that can be re-opened, settle only on a confirmed payment) follows its model. | `packages/invoices/src/payment.ts` |
| [btcpayserver/woocommerce-greenfield-plugin](https://github.com/btcpayserver/woocommerce-greenfield-plugin) @ `371ebfc744d0f0e9e6da581a1b00c11d59a6c026` | MIT | Ported (structure and flow, rewritten for the SettleKit API). Notice kept in the plugin's `LICENSE` and `NOTICE`. | `plugins/woocommerce/settlekit-for-woocommerce` |
