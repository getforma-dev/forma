import { h } from 'formajs';
import { OuterPanel } from './outer-panel';
import { InnerBadge } from './inner-badge';

export function NestedPage(props: { panelClass: string; badgeTitle: string }) {
  return h('main', { id: 'app' },
    // Island 0, whose own subtree starts island 1.
    OuterPanel({ panelClass: props.panelClass, badgeTitle: props.badgeTitle }),
    h('hr', null),
    // The same island component again, this time at page level: a second
    // island entry over one component name, with its own id and byte_offset.
    InnerBadge({ title: props.badgeTitle }),
  );
}
