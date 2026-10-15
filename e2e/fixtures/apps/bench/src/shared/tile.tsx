// A small interactive widget: a counter and a switch. The consumer-shaped pages hold many of
// them (2 on the login, 10 on the console, 50 on the canvas, 100 on the island page), each an
// island with four declared inputs. The page rows around them are server markup only.
import { h, createShow, createSignal } from '@getforma/core';

export type TileProps = { id: number; label: string; count: number; on: boolean };

export function Tile(props: TileProps) {
  const [count, setCount] = createSignal(props.count);
  const [on, setOn] = createSignal(props.on);
  return (
    <div class="tile" data-tile={props.id}>
      <span class="tile-label">{props.label}</span>
      <b class="tile-count">{() => count()}</b>
      <button class="tile-more" type="button" onClick={() => setCount(count() + 1)}>More</button>
      <button class="tile-switch" type="button" onClick={() => setOn(!on())}>Switch</button>
      {createShow(() => on(), () => <i class="tile-on">on</i>)}
    </div>
  );
}
