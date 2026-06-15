export const operationsPlusRoutes = [
  "GET /v1/reporting/revenue",
  "POST /v1/data-room/documents/:id/grant",
  "POST /v1/api-clients",
  "POST /v1/consulting-slots/:id/reservations",
  "GET /v1/content-access/:productId/modules",
  "POST /v1/approvals/:id/approve",
  "POST /v1/incidents/:id/resolve",
  "GET /v1/ledger/accounts/:id",
] as const;
