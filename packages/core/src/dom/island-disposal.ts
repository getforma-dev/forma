/** The activation entry installs this only while an island owns live work.
 * Ordinary keyed lists therefore do not retain the island activation graph. */
export let deactivateIslandsIn: ((node: Node) => void) | undefined;

export function setIslandDisposal(dispose?: (node: Node) => void): void {
  deactivateIslandsIn = dispose;
}
