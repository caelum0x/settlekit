export interface RunbookStep {
  title: string;
  command?: string;
  owner?: string;
  completed: boolean;
}

export interface Runbook {
  id: string;
  title: string;
  trigger: string;
  steps: RunbookStep[];
}

export function completeRunbookStep(runbook: Runbook, index: number): Runbook {
  return { ...runbook, steps: runbook.steps.map((step, stepIndex) => stepIndex === index ? { ...step, completed: true } : step) };
}

export function runbookComplete(runbook: Runbook): boolean {
  return runbook.steps.length > 0 && runbook.steps.every((step) => step.completed);
}
