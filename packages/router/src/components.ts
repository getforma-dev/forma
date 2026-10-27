import { isDangerousUrl } from '@getforma/core/navigation';

export interface LinkProps {
  href: string | URL;
  children?: string | Node | readonly (string | Node)[];
  target?: string;
  download?: string;
  class?: string;
  /** Leave this link to the browser. */
  native?: boolean;
  document?: Document;
}
/** An ordinary anchor; interception belongs to the root coordinator. */
export function Link(props: LinkProps): HTMLAnchorElement {
  const anchor = (props.document ?? document).createElement('a');
  const href = String(props.href);
  if (!isDangerousUrl(href, 'a')) anchor.href = href;
  if (props.target !== undefined) anchor.target = props.target;
  if (props.download !== undefined) anchor.download = props.download;
  if (props.class !== undefined) anchor.className = props.class;
  if (props.native) anchor.setAttribute('data-no-router', '');
  const children = props.children;
  if (children !== undefined) anchor.append(...(Array.isArray(children) ? children : [children as string | Node]));
  return anchor;
}
/** Return the exact child outlet supplied to a browser route render. */
export function Outlet(props: { outlet: HTMLElement }): HTMLElement { return props.outlet; }
