export interface FeatureGate {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
}

export function featureGateAllows(gate: FeatureGate, subjectId: string): boolean {
  if (!gate.enabled) return false;
  if (gate.rolloutPercent >= 100) return true;
  const bucket = [...subjectId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 100;
  return bucket < gate.rolloutPercent;
}

export function enableFeatureGate(gate: FeatureGate): FeatureGate {
  return { ...gate, enabled: true };
}
