// Native-declared props initialize the original component-local signals.
import { h, createShow, createSignal } from '@getforma/core';
export type ArrivalProps = {
  arrivalTitle: string; arrivalCash: string; arrivalStatus: string; arrivalSummary: boolean;
};
export const defaultArrival: ArrivalProps = {
  arrivalTitle: 'Household', arrivalCash: '$0.00', arrivalStatus: 'pending', arrivalSummary: false,
};
export function Arrival(props: ArrivalProps) {
  const [arrivalTitle] = createSignal(props.arrivalTitle);
  const [arrivalCash] = createSignal(props.arrivalCash);
  const [arrivalSummary] = createSignal(props.arrivalSummary);
  const [arrivalStatus, setArrivalStatus] = createSignal(props.arrivalStatus);
  const [retryVisible, setRetryVisible] = createSignal(false);
  let attempts = 0;
  async function loadWorkspace() {
    attempts += 1;
    setRetryVisible(false);
    try {
      const response = await fetch('/api/v1/instance');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setArrivalStatus('live');
    } catch {
      setArrivalStatus(`The workspace could not load (attempt ${attempts}). This snapshot is not live.`);
      setRetryVisible(true);
    }
  }
  return (
    <section class="arrival" ref={() => { void loadWorkspace(); }}>
      <h1 id="arrival-title">{() => arrivalTitle()}</h1>
      {createShow(
        () => arrivalSummary(),
        () => (
          <dl id="arrival-summary">
            <dt>Cash</dt>
            <dd id="arrival-cash">{() => arrivalCash()}</dd>
          </dl>
        ),
      )}
      <p id="arrival-status">{() => arrivalStatus()}</p>
      {createShow(
        () => retryVisible(),
        () => <button id="arrival-retry" type="button" onClick={() => { void loadWorkspace(); }}>Retry</button>,
      )}
    </section>
  );
}
