// The first thing the old tenant login did that 3.0.0 does not admit: a condition the compiler
// would have to evaluate (`mode() === 'login'`). The fix is a declared boolean the handler
// computes (fauth/ passes startLogin and startRegister). Built by apps.spec.ts, never served.
import { h, mount, activateIslands, createSignal } from '@getforma/core';

function Form(props: { mode: string }) {
  const [mode] = createSignal(props.mode);
  return <p>{() => (mode() === 'login' ? 'Sign in' : 'Create an account')}</p>;
}

function Page(props: { mode: string }) {
  return <main><Form mode={props.mode} /></main>;
}

activateIslands({ Form });
mount(() => Page({ mode: 'login' }), '#app');
