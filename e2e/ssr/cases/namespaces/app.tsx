import {h,createSignal,mount,activateIslands} from '@getforma/core';

// Six admitted FORMA-026 vectors, preserved as authored JSX to exercise FORMA-171.
// The seventh vector contains script and remains a construction refusal.
export function NamespaceVectors() {
  const [label,setLabel]=createSignal('initial');
  return <section id="namespace-root">
    <button id="namespace-update" onClick={()=>setLabel('updated')}>Update</button>
    <span id="namespace-live" title={label}>{()=>label()}</span>
    <div data-vector={"an icon with a title"}><svg viewBox={"0 0 10 10"}><title>{"Close"}</title><path d={"M0 0L10 10"}></path></svg></div>
    <div data-vector={"a linked icon whose link holds a title"}><svg viewBox={"0 0 10 10"}><a href={"#close"}><title>{"Close"}</title><circle r={"1"}></circle></a></svg></div>
    <div data-vector={"a foreignObject's content is HTML"}><svg><foreignObject width={"10"} height={"10"}><div><a href={"#more"}>{"more"}</a></div></foreignObject></svg></div>
    <div data-vector={"a desc's content is HTML"}><svg><desc>{"See "}<a href={"#x"}>{"x"}</a></desc></svg></div>
    <div data-vector={"an SVG name h() did not know: feDropShadow"}><svg><filter id={"f"}><feDropShadow dx={"1"}></feDropShadow></filter></svg></div>
    <div data-vector={"a MathML formula, HTML inside a token element"}><math><mrow><mi>{"x"}</mi><mo>{"+"}</mo><mn>{"1"}</mn></mrow><mtext><b>{"bold"}</b>{" "}<a href={"#m"}>{"m"}</a></mtext></math></div>
  </section>;
}
function Page(){return <main><NamespaceVectors/></main>}
activateIslands({NamespaceVectors});
mount(Page,'#app');

// A public compiled client function exercises the intentional script refusal;
// it is never part of the admitted native page's tree.
export function forbiddenScript(){return <svg><script type="text/plain">reference</script></svg>}
