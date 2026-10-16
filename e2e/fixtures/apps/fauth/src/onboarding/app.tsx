import { mount, activateIslands } from '@getforma/core';
import { RegistrationForm, defaultOnboarding } from './registration';
import { OnboardingPage } from './page';

await activateIslands({ RegistrationForm });
mount(() => OnboardingPage(defaultOnboarding), '#app');
