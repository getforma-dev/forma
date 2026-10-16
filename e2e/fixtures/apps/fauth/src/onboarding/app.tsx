import { mount, activateIslands } from '@getforma/core';
import { RegistrationForm, defaultOnboarding } from './registration';
import { OnboardingPage } from './page';

activateIslands({ RegistrationForm });
mount(() => OnboardingPage(defaultOnboarding), '#app');
