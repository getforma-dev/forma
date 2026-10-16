import { mount, activateIslands } from '@getforma/core';
import { AuthForm, OAuthButtons, defaultTenantLogin } from './login';
import { TenantLoginPage } from './page';

await activateIslands({ OAuthButtons, AuthForm });
mount(() => TenantLoginPage(defaultTenantLogin), '#app');
