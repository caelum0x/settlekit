export type ArcAddress = `0x${string}`;

export function isArcAddress(value: string): value is ArcAddress {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export interface ArcSettlementInstruction {
  network: "arc";
  to: ArcAddress;
  amount: string;
  currency: "USDC";
}
