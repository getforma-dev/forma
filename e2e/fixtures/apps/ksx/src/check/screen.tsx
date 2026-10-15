// A button-check screen for the 3.0.0 contract: the controller roster and every control chip
// are server markup read from one nested payload, and the two islands own the live parts.
// The booleans the old page's server injected under `show:` names (`hasSlots`, `noSlots`,
// `hasLoss`, `quiet`) are plain declared props now, named by the handler, never by the
// walker. The wire type of a slot's bindings is an array of {control, keys}: the old
// map from control name to key list is outside the closed type set (negative/record-bindings).
import { h, createShow, createSignal } from '@getforma/core';

export type Binding = { control: string; keys: string[] };
export type Slot = {
  number: number;
  persona: string;
  personaLabel: string;
  preset: string;
  keyboard: string;
  summary: string;
  bindings: Binding[];
};
export type Mapper = { generatedAt: string; source: string; slots: Slot[] };
export type Session = { reachable: boolean; running: boolean; line: string; profile?: string | null };
export type Chip = { id: number; slot: string; player: string; control: string; label: string; keys: string };

export type CheckProps = {
  mapper: Mapper;
  session: Session;
  feedHint: string;
  feedLine: string;
  lossLine: string;
  framesSeen: number;
  chips: Chip[];
  hasSlots: boolean;
  noSlots: boolean;
  hasLoss: boolean;
  quiet: boolean;
  emptyHeading: string;
  emptyLine: string;
};

export const defaultCheck: CheckProps = {
  mapper: { generatedAt: '', source: '', slots: [] },
  session: { reachable: false, running: false, line: '' },
  feedHint: '',
  feedLine: '',
  lossLine: '',
  framesSeen: 0,
  chips: [],
  hasSlots: false,
  noSlots: true,
  hasLoss: false,
  quiet: true,
  emptyHeading: '',
  emptyLine: '',
};

/** The strip above the grid: the session, the feed, a frame count and a loss warning. */
export function FeedStatus(props: {
  sessionLine: string;
  feedHint: string;
  feedLine: string;
  lossLine: string;
  framesSeen: number;
  hasLoss: boolean;
  quiet: boolean;
  running: boolean;
}) {
  const [sessionLine] = createSignal(props.sessionLine);
  const [feedLine, setFeedLine] = createSignal(props.feedLine);
  const [lossLine] = createSignal(props.lossLine);
  const [framesSeen, setFramesSeen] = createSignal(props.framesSeen);
  const [hasLoss] = createSignal(props.hasLoss);
  const [quiet, setQuiet] = createSignal(props.quiet);
  const [running] = createSignal(props.running);
  return (
    <section id="feed" aria-label="Feed status">
      <p id="session-line">{() => sessionLine()}</p>
      <p id="feed-hint">{props.feedHint}</p>
      <p id="feed-line">{() => feedLine()}</p>
      <p id="frames">Frames seen: <span id="frames-seen">{() => framesSeen()}</span></p>
      {createShow(() => hasLoss(), () => <p id="loss-line" role="status">{() => lossLine()}</p>)}
      {createShow(() => quiet(), () => <p id="quiet-line">Nothing pressed yet.</p>)}
      {createShow(() => running(), () => <p id="running-line">Play is active.</p>)}
      <button id="count-frame" type="button" onClick={() => { setFramesSeen(framesSeen() + 1); setQuiet(false); setFeedLine('Receiving frames.'); }}>
        Count a frame
      </button>
    </section>
  );
}

/** The live echo: a key the panel sends lights every chip it drives, on every slot at once. */
export function LiveEcho(props: { hint: string }) {
  const [last, setLast] = createSignal('none');
  const [echoes, setEchoes] = createSignal(0);
  const [listening, setListening] = createSignal(false);
  function listen() {
    if (listening()) return;
    setListening(true);
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
      let lit = 0;
      for (const chip of Array.from(document.querySelectorAll<HTMLElement>('.chip'))) {
        const on = (chip.getAttribute('data-keys') ?? '').split(' ').includes(key);
        chip.classList.toggle('lit', on);
        if (on) lit += 1;
      }
      setLast(key);
      setEchoes(lit);
    });
  }
  return (
    <section id="echo" aria-label="Live echo" ref={() => listen()}>
      <p id="echo-hint">{props.hint}</p>
      <p id="echo-last">Last key: {() => last()}</p>
      <p id="echo-count">Chips lit: {() => echoes()}</p>
    </section>
  );
}
