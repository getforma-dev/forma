import { h, createShow } from '@getforma/core';
import { AuthForm, OAuthButtons, type TenantLoginProps } from './login';

export function TenantLoginPage(props: TenantLoginProps) {
  return (
    <main class="lc-page">
      <div class="lc-card">
        <div class="lc-logo-area">
          {createShow(() => props.hasLogo, () => <img class="lc-logo" id="tenant-logo" src={props.logoUrl} alt={props.appName} />)}
          <div class="lc-app-name" id="tenant-name">{props.appName}</div>
        </div>
        <OAuthButtons hasGoogle={props.hasGoogle} hasGithub={props.hasGithub} hasEmail={props.hasEmail} />
        <AuthForm
          startLogin={props.startLogin}
          startRegister={props.startRegister}
          allowPublicSignup={props.allowPublicSignup}
          inviteOnly={props.inviteOnly}
          inviteNotice={props.inviteNotice}
        />
        <div class="powered-note">
          Powered by <a class="powered-link" href="https://example.test" rel="noopener">Example Auth</a>
        </div>
      </div>
    </main>
  );
}
