import { h } from '@getforma/core';
import { RegistrationForm, type OnboardingProps } from './registration';

export function OnboardingPage(props: OnboardingProps) {
  return (
    <main class="ob-page">
      <h1 id="ob-title">Get started</h1>
      <p>Create a workspace for your team.</p>
      <RegistrationForm clientId={props.clientId} serverUrl={props.serverUrl} hasGoogle={props.hasGoogle} hasGithub={props.hasGithub} hasOAuth={props.hasOAuth} />
    </main>
  );
}
