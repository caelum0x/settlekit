export {
  createWalletsClient,
  DEFAULT_W3S_BASE_URL,
  SANDBOX_W3S_BASE_URL,
} from "./client.js";
export type {
  WalletsClient,
  WalletsClientConfig,
  EntitySecretProvider,
  EntitySecretInput,
  CreateWalletSetInput,
  CreateWalletsInput,
  ListWalletsInput,
  CreateTransferInput,
} from "./client.js";

export { pollTransaction, buildContractExecutionRequest } from "./contract-execution.js";
export type {
  CreateContractExecutionInput,
  PollTransactionOptions,
} from "./contract-execution.js";

export { createUserWalletsClient } from "./user-wallets.js";
export type {
  UserWalletsClient,
  UserWalletsClientConfig,
  UserToken,
  UserChallenge,
  CreateUserWalletChallengeInput,
  CreateUserTransferChallengeInput,
} from "./user-wallets.js";

export { buildUrl, createFetchWalletsHttp } from "./http.js";
export type {
  WalletsHttp,
  WalletsRequest,
  WalletsResponse,
  FetchWalletsHttpOptions,
} from "./http.js";

export type {
  CircleAccountType,
  CircleBlockchain,
  CircleCustodyType,
  CircleFeeLevel,
  CircleToken,
  CircleTokenBalance,
  CircleTransactionResource,
  CircleTransactionState,
  CircleWalletResource,
  CircleWalletSet,
  CircleWalletState,
  CircleWalletsEnvelope,
  CircleWalletsErrorBody,
} from "./types.js";
