export type OnboardingStep =
  | "create_organization"
  | "connect_wallet"
  | "create_product"
  | "set_price"
  | "configure_delivery"
  | "publish_checkout";

export interface OnboardingProgress {
  organizationId: string;
  completedSteps: OnboardingStep[];
}

export function completeOnboardingStep(progress: OnboardingProgress, step: OnboardingStep): OnboardingProgress {
  return progress.completedSteps.includes(step)
    ? progress
    : { ...progress, completedSteps: [...progress.completedSteps, step] };
}

export function nextOnboardingStep(progress: OnboardingProgress): OnboardingStep | undefined {
  const steps: OnboardingStep[] = ["create_organization", "connect_wallet", "create_product", "set_price", "configure_delivery", "publish_checkout"];
  return steps.find((step) => !progress.completedSteps.includes(step));
}
