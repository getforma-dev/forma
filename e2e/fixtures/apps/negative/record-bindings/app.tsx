// Acceptance 4 (FORMA-188): a props type outside the closed type set fails the build with the
// declared-contract code, naming the type. This is the wire type the studio's check payload
// has today: a map from control name to key list. The fixture page (ksx/) spells it as an array
// of {control, keys}. Built by apps.spec.ts, never served.
import { h, mount, activateIslands } from '@getforma/core';

type Bindings = Record<string, string[]>;

function Roster(props: { bindings: Bindings; title: string }) {
  return <section><h2>{props.title}</h2></section>;
}

function Page(props: { bindings: Bindings; title: string }) {
  return <main><Roster bindings={props.bindings} title={props.title} /></main>;
}

activateIslands({ Roster });
mount(() => Page({ bindings: {}, title: '' }), '#app');
