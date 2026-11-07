/** The user whose finished onboarding this page load already confirmed (see OnboardingGate). */
let finishedFor: string | null = null;

export function onboardingFinishedFor(userId: string): boolean {
  return finishedFor === userId;
}

export function rememberOnboardingFinished(userId: string) {
  finishedFor = userId;
}

/** Clears the remembered answer (after onboarding finishes, or on sign-out). */
export function forgetOnboarding() {
  finishedFor = null;
}
