// The platform's get-started page: which sign-up providers exist is the only thing the
// server knows, and it knows it as three booleans. The workspace form is the visitor's.
import { h, createShow, createSignal } from '@getforma/core';

export type OnboardingProps = {
  clientId: string;
  serverUrl?: string;
  hasGoogle: boolean;
  hasGithub: boolean;
  hasOAuth: boolean;
};

export const defaultOnboarding: OnboardingProps = { clientId: '', hasGoogle: false, hasGithub: false, hasOAuth: false };

export function RegistrationForm(props: OnboardingProps) {
  const [workspace, setWorkspace] = createSignal('');
  const [pressed, setPressed] = createSignal(false);
  const [agreed, setAgreed] = createSignal(false);
  return (
    <form id="registration" onSubmit={(event: Event) => { event.preventDefault(); setPressed(true); }}>
      {createShow(
        () => props.hasOAuth,
        () => (
          <div id="oauth-row">
            {createShow(() => props.hasGoogle, () => <button id="ob-google" type="button">Sign up with Google</button>)}
            {createShow(() => props.hasGithub, () => <button id="ob-github" type="button">Sign up with GitHub</button>)}
            <p>or use your email</p>
          </div>
        ),
      )}
      <label for="ob-workspace">Workspace name</label>
      <input id="ob-workspace" type="text" value={() => workspace()} onInput={(e: Event) => setWorkspace((e.target as HTMLInputElement).value)} />
      <p id="ob-echo">{() => workspace()}</p>
      <label for="ob-agree">
        <input id="ob-agree" type="checkbox" checked={() => agreed()} onChange={(e: Event) => setAgreed((e.target as HTMLInputElement).checked)} />
        I accept the terms
      </label>
      <button id="ob-submit" type="submit">Create workspace</button>
      {createShow(() => pressed(), () => <p id="ob-pressed" role="status">Workspace request noted.</p>)}
      <p id="ob-client">Client {props.clientId}</p>
    </form>
  );
}
