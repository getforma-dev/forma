// One hundred islands on one page (N3's activation case). Island 0 is seeded 7 and island 1 is
// seeded 1001: the audit's "7 stays 7, 1001 stays 1001", on the page that holds a hundred.
import { h, createList } from '@getforma/core';
import { Tile, type TileProps } from '../shared/tile';

export type Islands100Props = { title: string; tiles: TileProps[] };

export const defaultIslands100: Islands100Props = { title: '', tiles: [] };

export function Islands100Page(props: Islands100Props) {
  return (
    <main class="islands">
      <h1>{props.title}</h1>
      <section class="tiles">
        {createList(
          () => props.tiles,
          (tile) => tile.id,
          (tile) => <Tile id={tile.id} label={tile.label} count={tile.count} on={tile.on} />,
        )}
      </section>
    </main>
  );
}
