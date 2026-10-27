import initialize from './client';
import type { NavigationBootstrap } from '@getforma/router';
export default function initializeNext(bootstrap: NavigationBootstrap) {
  document.documentElement.setAttribute('data-native-generation', 'next');
  initialize(bootstrap);
}
