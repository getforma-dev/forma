// The arrival island of a household finance page, written for the 3.0.0 contract:
// every value the server knows arrives as a declared prop, seeds a component-local
// signal, and is rendered through holes and one conditional; the island's own
// network call only moves the status line.
import { h, createShow, createSignal } from '@getforma/core';

export type ArrivalProps = {
  arrivalTitle: string;
  arrivalDate: string;
  arrivalCash: string;
  arrivalBills: string;
  arrivalIncome: string;
  arrivalStatus: string;
  arrivalSummary: boolean;
};

/** What the browser-only build mounts when nothing server-rendered is adopted. */
export const defaultArrival: ArrivalProps = {
  arrivalTitle: 'Household',
  arrivalDate: '',
  arrivalCash: 'Pending',
  arrivalBills: '-',
  arrivalIncome: '-',
  arrivalStatus: 'Loading',
  arrivalSummary: false,
};

export function HouseholdArrival(props: ArrivalProps) {
  const [arrivalTitle] = createSignal(props.arrivalTitle);
  const [arrivalDate] = createSignal(props.arrivalDate);
  const [arrivalCash] = createSignal(props.arrivalCash);
  const [arrivalBills] = createSignal(props.arrivalBills);
  const [arrivalIncome] = createSignal(props.arrivalIncome);
  const [arrivalSummary] = createSignal(props.arrivalSummary);
  const [arrivalStatus, setArrivalStatus] = createSignal(props.arrivalStatus);
  const [retryVisible, setRetryVisible] = createSignal(false);
  let attempts = 0;
  async function loadWorkspace() {
    attempts += 1;
    setRetryVisible(false);
    try {
      const response = await fetch('/api/status');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setArrivalStatus('Loaded.');
    } catch {
      setArrivalStatus(`Loading failed (attempt ${attempts}). Showing the opening snapshot.`);
      setRetryVisible(true);
    }
  }
  return (
    <section class="arrival" aria-label="Arrival" ref={() => { void loadWorkspace(); }}>
      <h1 id="arrival-title">{() => arrivalTitle()}</h1>
      {createShow(
        () => arrivalSummary(),
        () => (
          <div id="arrival-summary" aria-label="Opening snapshot">
            <p>Snapshot taken: <span id="arrival-date">{() => arrivalDate()}</span></p>
            <dl>
              <dt>Cash on hand</dt>
              <dd id="arrival-cash">{() => arrivalCash()}</dd>
              <dt>Bills due</dt>
              <dd id="arrival-bills">{() => arrivalBills()}</dd>
              <dt>Income expected</dt>
              <dd id="arrival-income">{() => arrivalIncome()}</dd>
            </dl>
          </div>
        ),
      )}
      <p id="arrival-status" role="status">{() => arrivalStatus()}</p>
      {createShow(
        () => retryVisible(),
        () => (
          <button id="arrival-retry" type="button" onClick={() => { void loadWorkspace(); }}>
            Try again
          </button>
        ),
      )}
    </section>
  );
}
