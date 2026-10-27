// Upstream excerpt; not a standalone module.
// Copyright Google LLC. MIT license: ../LICENSE.angular.txt
// Source: https://github.com/angular/angular/blob/ecaec13db4fde7ceb0104105ee356bf00596f3d6/adev/src/app/core/services/content-loader.service.ts#L19-L44
// Exact source lines 19–44; indentation retained.

  async getContent(path: string): Promise<DocContent> {
    // If the path does not end with a file extension, add `.md.html` as the default
    if (!path.match(/\.\w+$/)) {
      path += '.md.html';
    }
    try {
      let promise = this.cache.get(path);
      if (!promise) {
        promise = firstValueFrom(
          this.httpClient
            .get(`assets/content/${path}`, {
              responseType: 'text',
            })
            .pipe(map((contents) => ({contents, id: path}))),
        );
        this.cache.set(path, promise);
      }
      return await promise;
    } catch (e) {
      const errorResponse = e as HttpErrorResponse;
      if (!(e instanceof HttpErrorResponse) || errorResponse.status !== 404) {
        // assume 404 errors are permanent but don't cache others that may be temporary
        this.cache.delete(path);
      }
      throw e;
    }
