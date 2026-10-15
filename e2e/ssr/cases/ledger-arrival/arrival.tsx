// Declared SSR props preserve the existing explicit island seed bridge while
// FORMA-103 owns automatic browser state decoding and activation.
import { h, createShow, createSignal } from '@getforma/core';
export type ArrivalProps = {
  arrivalTitle: string; arrivalCash: string; arrivalStatus: string; arrivalSummary: boolean;
};
export const defaultArrival: ArrivalProps = {
  arrivalTitle: 'Household', arrivalCash: '$0.00', arrivalStatus: 'pending', arrivalSummary: false,
};
export function seedArrival(props: Record<string, unknown> | null): ArrivalProps {
  return {
    arrivalTitle: typeof props?.arrivalTitle === 'string' ? props.arrivalTitle : defaultArrival.arrivalTitle,
    arrivalCash: typeof props?.arrivalCash === 'string' ? props.arrivalCash : defaultArrival.arrivalCash,
    arrivalStatus: typeof props?.arrivalStatus === 'string' ? props.arrivalStatus : defaultArrival.arrivalStatus,
    arrivalSummary: typeof props?.arrivalSummary === 'boolean' ? props.arrivalSummary : defaultArrival.arrivalSummary,
  };
}
let loadCurrent: () => Promise<void> = async () => {};
export async function loadWorkspace(): Promise<void> { await loadCurrent(); }
export function Arrival(props: ArrivalProps) {
  const [arrivalTitle] = createSignal(props.arrivalTitle);
  const [arrivalCash] = createSignal(props.arrivalCash);
  const [arrivalSummary] = createSignal(props.arrivalSummary);
  const [arrivalStatus, setArrivalStatus] = createSignal(props.arrivalStatus);
  const [retryVisible, setRetryVisible] = createSignal(false);
  let attempts = 0;
  loadCurrent = async () => {
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
  };
  return (
    <section class="arrival">
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
