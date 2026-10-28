import { h, mount } from '@getforma/core';
function Fourth() { return <strong>four levels</strong>; }
function Third() { return <div><Fourth /></div>; }
function Second() { return <section><Third /></section>; }
function First() { return <article><Second /></article>; }
function Page() { return <main><First /></main>; }
mount(() => Page(), '#app');
