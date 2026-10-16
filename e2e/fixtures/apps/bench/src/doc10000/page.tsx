// A document viewer's weight: about 10,000 nodes and 5 islands (design.md A4: the largest document,
// 5,000 lines in the consumer it is shaped like, each line a handful of nodes).
import { h, createList } from '@getforma/core';
import { Tile, type TileProps } from '../shared/tile';

export type Line = { id: number; text: string; note: string };
export type Doc10000Props = { title: string; lines: Line[]; tiles: TileProps[] };

export const defaultDoc10000: Doc10000Props = { title: '', lines: [], tiles: [] };

export function Doc10000Page(props: Doc10000Props) {
  return (
    <main class="document">
      <h1>{props.title}</h1>
      <section class="tiles">
        {createList(
          () => props.tiles,
          (tile) => tile.id,
          (tile) => <Tile id={tile.id} label={tile.label} count={tile.count} on={tile.on} />,
        )}
      </section>
      <article>
        {createList(
          () => props.lines,
          (line) => line.id,
          (line) => <p data-line={line.id}><span>{line.text}</span><em>{line.note}</em></p>,
        )}
      </article>
    </main>
  );
}
