// A tenant's hosted login page for the 3.0.0 contract. Everything the server decides
// (which providers, whether sign-up is open, which mode the page starts in) arrives as a
// declared prop; the two islands own only what a visitor changes. A value the old page
// computed in the browser (`mode() === 'login'`, `providers.indexOf('google') >= 0`)
// is a prop the handler computes once, because the compiler admits holes, paths,
// conditionals and rows over declared props and nothing it would have to evaluate (DR-2).
import { h, createShow, createSignal } from '@getforma/core';

export type Provider = 'google' | 'github' | 'email';
export type SignupMode = 'public' | 'invite_only';

export type TenantLoginProps = {
  slug: string;
  appName: string;
  logoUrl?: string;
  hasLogo: boolean;
  primaryColor: string;
  providers: Provider[];
  signupMode: SignupMode;
  loginRedirectUrl: string;
  startLogin: boolean;
  startRegister: boolean;
  hasGoogle: boolean;
  hasGithub: boolean;
  hasOAuth: boolean;
  hasEmail: boolean;
  inviteOnly: boolean;
  allowPublicSignup: boolean;
  inviteNotice: string;
};

export const defaultTenantLogin: TenantLoginProps = {
  slug: '',
  appName: '',
  primaryColor: '#4a6fa5',
  providers: [],
  signupMode: 'public',
  loginRedirectUrl: '/',
  startLogin: true,
  startRegister: false,
  hasLogo: false,
  hasGoogle: false,
  hasGithub: false,
  hasOAuth: false,
  hasEmail: true,
  inviteOnly: false,
  allowPublicSignup: true,
  inviteNotice: '',
};

/** The provider buttons: the only part of the page that leaves it, so the only part that waits on the visitor. */
export function OAuthButtons(props: { hasGoogle: boolean; hasGithub: boolean; hasEmail: boolean }) {
  const [chosen, setChosen] = createSignal('');
  const [hasChoice, setHasChoice] = createSignal(false);
  return (
    <div class="lc-oauth-buttons">
      {createShow(
        () => props.hasGoogle,
        () => (
          <button id="oauth-google" class="lc-btn lc-btn-oauth" type="button" onClick={() => { setChosen('Continuing with Google'); setHasChoice(true); }}>
            Continue with Google
          </button>
        ),
      )}
      {createShow(
        () => props.hasGithub,
        () => (
          <button id="oauth-github" class="lc-btn lc-btn-oauth" type="button" onClick={() => { setChosen('Continuing with GitHub'); setHasChoice(true); }}>
            Continue with GitHub
          </button>
        ),
      )}
      {createShow(
        () => hasChoice(),
        () => <p id="oauth-chosen" role="status">{() => chosen()}</p>,
      )}
    </div>
  );
}

/** The email form: sign in or create an account, with a password the visitor may reveal. */
export function AuthForm(props: { startLogin: boolean; startRegister: boolean; allowPublicSignup: boolean; inviteOnly: boolean; inviteNotice: string }) {
  const [signingIn, setSigningIn] = createSignal(props.startLogin);
  const [registering, setRegistering] = createSignal(props.startRegister);
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [name, setName] = createSignal('');
  const [reveal, setReveal] = createSignal(false);
  const [remember, setRemember] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [failure, setFailure] = createSignal('');
  function toggle() {
    const next = !registering();
    setRegistering(next);
    setSigningIn(!next);
    setFailed(false);
  }
  // The attribute is not a binding: a conditional `type` is outside the native subset, so the
  // click sets it, as the page it is shaped like does.
  function revealPassword() {
    const next = !reveal();
    setReveal(next);
    const input = document.getElementById('lc-password');
    if (input instanceof HTMLInputElement) input.type = next ? 'text' : 'password';
  }
  function submit(event: Event) {
    event.preventDefault();
    setFailure(email() === '' ? 'Enter your email address.' : 'This fixture does not sign anyone in.');
    setFailed(true);
  }
  return (
    <div class="lc-auth">
      <div class="lc-subtitle" id="auth-subtitle">{() => (registering() ? 'Create your account' : 'Sign in to your account')}</div>
      {createShow(
        () => props.inviteOnly,
        () => <div class="lc-notice" id="invite-notice">{props.inviteNotice}</div>,
      )}
      <form id="auth-form" onSubmit={submit}>
        {createShow(
          () => registering(),
          () => (
            <div class="lc-field">
              <label for="lc-name">Name</label>
              <input id="lc-name" type="text" placeholder="Your name" value={() => name()} onInput={(e: Event) => setName((e.target as HTMLInputElement).value)} />
            </div>
          ),
        )}
        <div class="lc-field">
          <label for="lc-email">Email</label>
          <input id="lc-email" type="email" placeholder="you@example.com" autocomplete="email" value={() => email()} onInput={(e: Event) => setEmail((e.target as HTMLInputElement).value)} />
        </div>
        <div class="lc-field">
          <label for="lc-password">Password</label>
          <input id="lc-password" type="password" autocomplete="current-password" value={() => password()} onInput={(e: Event) => setPassword((e.target as HTMLInputElement).value)} />
          <button id="lc-reveal" type="button" aria-label="Show or hide password" onClick={revealPassword}>
            {() => (reveal() ? 'Hide' : 'Show')}
          </button>
        </div>
        {createShow(
          () => signingIn(),
          () => <a id="lc-forgot" class="lc-link" href="#forgot">Forgot password?</a>,
        )}
        <label class="lc-remember" for="lc-remember">
          <input id="lc-remember" type="checkbox" checked={() => remember()} onChange={(e: Event) => setRemember((e.target as HTMLInputElement).checked)} />
          Remember email
        </label>
        {createShow(
          () => signingIn(),
          () => <button id="lc-submit-in" class="lc-btn lc-btn-primary" type="submit">Sign in</button>,
        )}
        {createShow(
          () => registering(),
          () => <button id="lc-submit-up" class="lc-btn lc-btn-primary" type="submit">Create account</button>,
        )}
      </form>
      {createShow(
        () => failed(),
        () => <div id="auth-failure" role="alert">{() => failure()}</div>,
      )}
      {createShow(
        () => props.allowPublicSignup,
        () => (
          <div class="lc-toggle">
            <button id="lc-toggle" class="lc-link" type="button" onClick={toggle}>
              {() => (registering() ? 'Already have an account? Sign in' : "Don't have an account? Sign up")}
            </button>
          </div>
        ),
      )}
    </div>
  );
}
