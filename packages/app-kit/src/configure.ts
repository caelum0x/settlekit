/**
 * One factory to build an {@link ArcPaymentClient}. The consumer injects a
 * configured Circle App Kit client; the kit key (needed by Swap) falls back to
 * the `CIRCLE_KIT_KEY` environment variable so it is never hardcoded.
 *
 * Live wiring (in the consumer, which owns the SDK dependency):
 *
 * ```ts
 * import { AppKit } from "@circle-fin/app-kit";
 * import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
 * import { configureAppKit } from "@settlekit/app-kit";
 *
 * const arc = configureAppKit({ sdk: new AppKit() });
 * const adapter = createViemAdapterFromProvider(provider);
 * const res = await arc.send({ adapter, chain: "Arc_Testnet", to, amount: "1.00" });
 * ```
 *
 * Tests/demos inject {@link LocalAppKitSdk} instead of a real `AppKit`.
 */

import { ArcPaymentClient, type ArcPaymentClientConfig } from "./client.js";

/** Options for {@link configureAppKit}. */
export interface ConfigureAppKitOptions<A> {
  sdk: ArcPaymentClientConfig<A>["sdk"];
  /** Circle kit key; defaults to `CIRCLE_KIT_KEY` from the environment. */
  kitKey?: string;
  /** Environment source for the kit-key fallback. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** Build a configured {@link ArcPaymentClient}. */
export function configureAppKit<A>(options: ConfigureAppKitOptions<A>): ArcPaymentClient<A> {
  const env = options.env ?? process.env;
  const kitKey = options.kitKey ?? env["CIRCLE_KIT_KEY"];
  return new ArcPaymentClient<A>({
    sdk: options.sdk,
    ...(kitKey !== undefined && kitKey.length > 0 ? { kitKey } : {}),
  });
}
