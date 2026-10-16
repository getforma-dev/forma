/** Compile-only public call contracts; this function is never executed. */
import * as runtime from '../runtime';
import type { MountHandle, TrustedHtml } from '../runtime';

function explicitRuntimeContracts(root: Element, html: TrustedHtml): void {
  const handle: MountHandle = runtime.mountMarkup(root, html, { tier: 'reviewed' });
  runtime.mountMarkup(root, html, { tier: 'compiled', grants: {}, config: { diagnostics: false, exprBudget: 100 } });
  handle.update(html);
  handle.unmount();
  // @ts-expect-error every public mount must name a tier
  runtime.mountMarkup(root, html);
  // @ts-expect-error granting authority does not replace a tier
  runtime.mountMarkup(root, html, { grants: { dom: true } });
  // @ts-expect-error raw strings are not the trustedHtml brand
  runtime.mountMarkup(root, '<p>raw</p>', { tier: 'reviewed' });
  // @ts-expect-error tierless mounting was removed
  runtime.mount(root);
  // @ts-expect-error tierless reconciliation was removed
  runtime.reconcile(root, html);
  // @ts-expect-error configuration belongs to each mount
  runtime.setDiagnostics(true);
}
void explicitRuntimeContracts;
