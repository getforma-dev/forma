import { h, createList, createShow } from '@getforma/core';
import { FeedStatus, LiveEcho, type CheckProps } from './screen';

export function CheckPage(props: CheckProps) {
  return (
    <main class="check">
      <h1 id="check-title">Input monitor</h1>
      <FeedStatus
        sessionLine={props.session.line}
        feedHint={props.feedHint}
        feedLine={props.feedLine}
        lossLine={props.lossLine}
        framesSeen={props.framesSeen}
        hasLoss={props.hasLoss}
        quiet={props.quiet}
        running={props.session.running}
      />
      <p id="generated">Roster read {props.mapper.generatedAt} from {props.mapper.source}.</p>
      <ul class="roster" id="roster">
        {createList(
          () => props.mapper.slots,
          (slot) => slot.number,
          (slot) => (
            <li data-slot={slot.number}>
              <b>P{slot.number}</b> {slot.personaLabel} ({slot.preset}, {slot.keyboard}): {slot.summary}
            </li>
          ),
        )}
      </ul>
      {createShow(
        () => props.noSlots,
        () => (
          <section id="empty">
            <h2>{props.emptyHeading}</h2>
            <p>{props.emptyLine}</p>
          </section>
        ),
      )}
      <LiveEcho hint={props.feedHint} chips={props.chips} hasSlots={props.hasSlots} />
    </main>
  );
}
