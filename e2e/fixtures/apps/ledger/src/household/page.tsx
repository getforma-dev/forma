import { h } from '@getforma/core';
import { HouseholdArrival, type ArrivalProps } from './arrival';

export function HouseholdPage(props: ArrivalProps) {
  return <main class="household">{HouseholdArrival(props)}</main>;
}
