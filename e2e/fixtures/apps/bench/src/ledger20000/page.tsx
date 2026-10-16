// A year of transactions: about 20,000 nodes and 5 islands (design.md A4: 2,000 transactions of
// 10 nodes, the heaviest page of the consumer it is shaped like).
import { h, createList } from '@getforma/core';
import { Tile, type TileProps } from '../shared/tile';

export type Txn = { id: number; date: string; payee: string; category: string; amount: string };
export type Ledger20000Props = { title: string; transactions: Txn[]; tiles: TileProps[] };

export const defaultLedger20000: Ledger20000Props = { title: '', transactions: [], tiles: [] };

export function Ledger20000Page(props: Ledger20000Props) {
  return (
    <main class="ledger">
      <h1>{props.title}</h1>
      <section class="tiles">
        {createList(
          () => props.tiles,
          (tile) => tile.id,
          (tile) => <Tile id={tile.id} label={tile.label} count={tile.count} on={tile.on} />,
        )}
      </section>
      <table>
        <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>Amount</th></tr></thead>
        <tbody>
          {createList(
            () => props.transactions,
            (txn) => txn.id,
            (txn) => (
              <tr data-txn={txn.id}>
                <td>{txn.date}</td>
                <td><b>{txn.payee}</b></td>
                <td>{txn.category}</td>
                <td>{txn.amount}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </main>
  );
}
