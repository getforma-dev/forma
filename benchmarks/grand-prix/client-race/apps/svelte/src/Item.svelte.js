// A row whose label is its own reactive state, so updating a label touches one text node.
export class Item {
  id;
  label = $state('');
  constructor(d) { this.id = d.id; this.label = d.label; }
}
