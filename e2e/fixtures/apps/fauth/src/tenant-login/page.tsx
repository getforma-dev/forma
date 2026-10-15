import { h, createShow } from '@getforma/core';
import { AuthForm, OAuthButtons, type TenantLoginProps } from './login';

export function TenantLoginPage(props: TenantLoginProps) {
  return (
    <main class="tl-page">
      <div class="tl-card">
        <div class="tl-logo-area">
          {createShow(() => props.hasLogo, () => <img class="tl-logo" id="tenant-logo" src={props.logoUrl} alt={props.appName} />)}
          <div class="tl-app-name" id="tenant-name">{props.appName}</div>
        </div>
        <OAuthButtons hasGoogle={props.hasGoogle} hasGithub={props.hasGithub} hasEmail={props.hasEmail} />
        <AuthForm
          startLogin={props.startLogin}
          startRegister={props.startRegister}
          allowPublicSignup={props.allowPublicSignup}
          inviteOnly={props.inviteOnly}
          inviteNotice={props.inviteNotice}
        />
        <div class="secured-badge">
          Secured by <a class="secured-badge-link" href="https://getforma.dev" rel="noopener">fAuth</a>
        </div>
      </div>
    </main>
  );
}
