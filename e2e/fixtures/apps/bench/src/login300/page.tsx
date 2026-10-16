// A login page's weight: about 300 nodes and 2 islands (design.md A4: a tenant login).
import { h, createList } from '@getforma/core';
import { Tile, type TileProps } from '../shared/tile';

export type Field = { id: number; name: string; label: string; hint: string };
export type Link = { id: number; text: string; href: string };
export type Login300Props = { title: string; lede: string; fields: Field[]; links: Link[]; tiles: TileProps[] };

export const defaultLogin300: Login300Props = { title: '', lede: '', fields: [], links: [], tiles: [] };

export function Login300Page(props: Login300Props) {
  return (
    <main class="login">
      <header>
        <h1>{props.title}</h1>
        <p>{props.lede}</p>
      </header>
      <form>
        {createList(
          () => props.fields,
          (field) => field.id,
          (field) => (
            <div class="field">
              <label for={field.name}>{field.label}</label>
              <input id={field.name} name={field.name} placeholder={field.hint} />
              <small>{field.hint}</small>
            </div>
          ),
        )}
      </form>
      <nav>
        <ul>
          {createList(
            () => props.links,
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
      <footer><p>Fixture page</p></footer>
    </main>
  );
}
