import { h } from '@getforma/core';
import { ShellCounter } from './page-shell';
import { PageA } from './page-a';
import { PageB } from './page-b';
export interface PlainProps { seed: number; count: number; name: string; csrf: string; error: string }
// Fixed document-navigation baseline: the same layout and leaf island sources,
// full-page composition, no router import and no navigation owner declaration.
export function PlainA(props: PlainProps) {
  return <section id="native-layout">
    <header><h2>Native owner fixture</h2><ShellCounter seed={props.seed}/></header>
    <nav><a id="to-a" href="/native/a">Route A</a> <a id="to-b" href="/native/b">Route B</a></nav>
    <div><PageA count={props.count} name={props.name} csrf={props.csrf} error={props.error}/></div>
  </section>;
}
export function PlainB(props: PlainProps) {
  return <section id="native-layout">
    <header><h2>Native owner fixture</h2><ShellCounter seed={props.seed}/></header>
    <nav><a id="to-a" href="/native/a">Route A</a> <a id="to-b" href="/native/b">Route B</a></nav>
    <div><PageB count={props.count} name={props.name} csrf={props.csrf} error={props.error}/></div>
  </section>;
}
