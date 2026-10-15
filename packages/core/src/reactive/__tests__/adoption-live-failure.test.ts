import {it,expect,vi} from 'vitest';
import {AdoptionLifecycle} from '../adoption-lifecycle.js';
import {createSignal} from '../signal.js';
import {createEffect} from '../effect.js';
import {onCleanup} from '../cleanup.js';

it('cleans work created after a nested adopted effect aborts a live parent rerun', () => {
  const failure=vi.fn(), scope=new AdoptionLifecycle({failure});
  const [trigger,setTrigger]=createSignal(0), [later,setLater]=createSignal(0);
  const laterRun=vi.fn(), laterClean=vi.fn(), parentClean=vi.fn(), failedClean=vi.fn();
  scope.run(() => createEffect(() => {
    if (trigger()===0) return;
    createEffect(() => {onCleanup(failedClean); throw new Error('nested live failure');});
    createEffect(() => {later(); laterRun(); onCleanup(laterClean);});
    onCleanup(parentClean);
  }));
  scope.seal(); scope.seed(); scope.publish();
  setTrigger(1);
  expect(scope.phase).toBe('aborted');
  expect(failure).toHaveBeenCalledOnce();
  const runs=laterRun.mock.calls.length;
  setLater(1); setLater(2); scope.abort();
  expect(laterRun).toHaveBeenCalledTimes(runs);
  expect(laterClean).toHaveBeenCalledTimes(runs);
  expect(parentClean).toHaveBeenCalledOnce();
  expect(failedClean).toHaveBeenCalledOnce();
});
