// An administration console's weight: about 1,500 nodes and 10 islands (design.md A4: a console).
import { h, createList } from '@getforma/core';
import { Tile, type TileProps } from '../shared/tile';

export type NavLink = { id: number; text: string; href: string };
export type TableRow = { id: number; name: string; status: string; owner: string; updated: string };
export type Console1500Props = { title: string; nav: NavLink[]; rows: TableRow[]; tiles: TileProps[] };

export const defaultConsole1500: Console1500Props = { title: '', nav: [], rows: [], tiles: [] };

export function Console1500Page(props: Console1500Props) {
  return (
    <main class="console">
      <h1>{props.title}</h1>
      <nav>
        <ul>
          {createList(
            () => props.nav,
            (link) => link.id,
            (link) => <li><a href={link.href}>{link.text}</a></li>,
          )}
        </ul>
      </nav>
      <section class="tiles">
        {createList(
          () => props.tiles,
          (tile) => tile.id,
          (tile) => <Tile id={tile.id} label={tile.label} count={tile.count} on={tile.on} />,
        )}
      </section>
      <table>
        <thead><tr><th>Name</th><th>Status</th><th>Owner</th><th>Updated</th></tr></thead>
        <tbody>
          {createList(
            () => props.rows,
            (row) => row.id,
            (row) => <tr data-row={row.id}><td>{row.name}</td><td>{row.status}</td><td>{row.owner}</td><td>{row.updated}</td></tr>,
          )}
        </tbody>
      </table>
    </main>
  );
}
