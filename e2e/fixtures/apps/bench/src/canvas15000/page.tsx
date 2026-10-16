// A canvas of modules: about 15,000 nodes and 50 islands (design.md A4: 50 modules of 300 nodes,
// one island each). The cells inside a module are a list nested in the module's row.
import { h, createList } from '@getforma/core';
import { Tile } from '../shared/tile';

export type Cell = { id: number; text: string };
export type Module = { id: number; title: string; count: number; on: boolean; cells: Cell[] };
export type Canvas15000Props = { title: string; modules: Module[] };

export const defaultCanvas15000: Canvas15000Props = { title: '', modules: [] };

export function Canvas15000Page(props: Canvas15000Props) {
  return (
    <main class="canvas">
      <h1>{props.title}</h1>
      {createList(
        () => props.modules,
        (module) => module.id,
        (module) => (
          <section class="module">
            <h3>{module.title}</h3>
            <Tile id={module.id} label={module.title} count={module.count} on={module.on} />
            <ul>
              {createList(
                () => module.cells,
                (cell) => cell.id,
                (cell) => <li><span>{cell.text}</span></li>,
              )}
            </ul>
          </section>
        ),
      )}
    </main>
  );
}
