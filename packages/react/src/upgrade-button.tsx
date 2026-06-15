"use client";

/**
 * <UpgradeButton> — the canonical paywall fallback (plan §4). Clicking it
 * creates a checkout session via {@link useCheckout} and redirects the buyer to
 * pay. Pass the checkout `input` describing what they are upgrading to.
 */
import { createElement, useCallback } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { CheckoutSession } from "@settlekit/common";
import { useCheckout } from "./use-checkout.js";
import type { CreateCheckoutInput } from "./types.js";

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "children"
>;

/** Props for {@link UpgradeButton}. */
export interface UpgradeButtonProps extends NativeButtonProps {
  /** The checkout session to create when the button is clicked. */
  input: CreateCheckoutInput;
  /** Button label. Defaults to "Upgrade". */
  children?: ReactNode;
  /** Called after the session is created, before redirecting. */
  onCheckoutCreated?: (session: CheckoutSession) => void;
  /** Called if creating the checkout session fails. */
  onError?: (error: unknown) => void;
  /** When false, do not auto-redirect after creating the session. */
  redirect?: boolean;
}

/** A button that starts a SettleKit checkout/upgrade flow. */
export function UpgradeButton(props: UpgradeButtonProps): ReactNode {
  const {
    input,
    children = "Upgrade",
    onCheckoutCreated,
    onError,
    redirect = true,
    disabled,
    ...buttonProps
  } = props;

  const { createCheckout, redirectToCheckout, loading } = useCheckout();

  const handleClick = useCallback(async (): Promise<void> => {
    try {
      const session = await createCheckout(input);
      onCheckoutCreated?.(session);
      if (redirect) redirectToCheckout(session.id);
    } catch (error) {
      onError?.(error);
    }
  }, [createCheckout, redirectToCheckout, input, onCheckoutCreated, onError, redirect]);

  return createElement(
    "button",
    {
      type: "button",
      ...buttonProps,
      disabled: disabled ?? loading,
      onClick: () => {
        void handleClick();
      },
    },
    children,
  );
}
