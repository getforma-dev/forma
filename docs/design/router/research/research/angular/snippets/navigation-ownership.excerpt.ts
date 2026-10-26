// Upstream excerpt; not a standalone module.
// Copyright Google LLC. MIT license: ../LICENSE.angular.txt
// Source: https://github.com/angular/angular/blob/ecaec13db4fde7ceb0104105ee356bf00596f3d6/packages/router/src/navigation_transition.ts#L452-L459
// Exact source lines 452–459; indentation retained.

      // Using switchMap so we cancel executing navigations when a new one comes in
      switchMap((overallTransitionState) => {
        let abortable = true;
        let completedOrAborted = false;
        const abortController = new AbortController();
        const shouldContinueNavigation = () => {
          return !completedOrAborted && this.currentTransition?.id === overallTransitionState.id;
        };
