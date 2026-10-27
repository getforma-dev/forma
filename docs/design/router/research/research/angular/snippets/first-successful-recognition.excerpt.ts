// Upstream excerpt; not a standalone module.
// Copyright Google LLC. MIT license: ../LICENSE.angular.txt
// Source: https://github.com/angular/angular/blob/ecaec13db4fde7ceb0104105ee356bf00596f3d6/packages/router/src/recognize.ts#L251-L284
// Exact source lines 251–284; indentation retained.

  async processSegment(
    injector: EnvironmentInjector,
    routes: Route[],
    segmentGroup: UrlSegmentGroup,
    segments: UrlSegment[],
    outlet: string,
    allowRedirects: boolean,
    parentRoute: ActivatedRouteSnapshot,
  ): Promise<TreeNode<ActivatedRouteSnapshot> | NoLeftoversInUrl> {
    for (const r of routes) {
      try {
        return await this.processSegmentAgainstRoute(
          r._injector ?? injector,
          routes,
          r,
          segmentGroup,
          segments,
          outlet,
          allowRedirects,
          parentRoute,
        );
      } catch (e: any) {
        if (e instanceof NoMatch || isEmptyError(e)) {
          continue;
        }
        throw e;
      }
    }

    if (noLeftoversInUrl(segmentGroup, segments, outlet)) {
      return new NoLeftoversInUrl();
    }
    throw new NoMatch(segmentGroup);
  }
