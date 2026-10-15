import { h, createList, createShow } from '@getforma/core';
import { FeedStatus, LiveEcho, type CheckProps } from './screen';

export function CheckPage(props: CheckProps) {
  return (
    <main class="check">
      <h1 id="check-title">Button check</h1>
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
      {createShow(
        () => props.hasSlots,
        () => (
          <ul class="chips" id="chips">
            {createList(
              () => props.chips,
              (chip) => chip.id,
              (chip) => (
                <li class="chip" data-slot={chip.slot} data-control={chip.control} data-keys={chip.keys}>
                  <b>{chip.player}</b> <span>{chip.label}</span>
                </li>
              ),
            )}
          </ul>
        ),
      )}
      <LiveEcho hint={props.feedHint} />
    </main>
  );
}
