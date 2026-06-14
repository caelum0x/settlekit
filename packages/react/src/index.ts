export interface PaywallProps {
  allowed?: boolean;
  fallback?: unknown;
  children: unknown;
}

export function Paywall(props: PaywallProps): unknown {
  return props.allowed === false ? props.fallback ?? null : props.children;
}

export function useEntitlement(allowed: boolean): { allowed: boolean } {
  return { allowed };
}
