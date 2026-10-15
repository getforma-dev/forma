import { h } from '@getforma/core';
type Props = {
  value: Map<string, string>; // expect: BUILD-610
};
export function Page(props: Props) { return <p>Declared page</p>; }
