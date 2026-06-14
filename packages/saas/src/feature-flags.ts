export function featureEnabled(features: Record<string, boolean | number | string>, feature: string): boolean {
  return features[feature] === true;
}

export function featureValue(features: Record<string, boolean | number | string>, feature: string): boolean | number | string | undefined {
  return features[feature];
}
