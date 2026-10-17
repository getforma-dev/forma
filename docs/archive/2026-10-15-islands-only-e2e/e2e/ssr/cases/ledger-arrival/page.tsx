import { h } from '@getforma/core';
import { Arrival, type ArrivalProps } from './arrival';

export function ArrivalPage(props: ArrivalProps) {
  return <main class="household">{Arrival(props)}</main>;
}
