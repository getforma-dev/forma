
        import { h, mount, createSignal } from 'formajs';
        const [status] = createSignal('idle');
        mount(() => {
          const [open] = createSignal(false);
          return h('div', { id: 'app' }, h('b', null, () => status()), h('i', null, () => open()));
        }, '#app');
      