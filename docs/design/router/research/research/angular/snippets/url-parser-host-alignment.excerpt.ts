// Upstream excerpt; not a standalone module.
// Copyright Google LLC. MIT license: ../LICENSE.angular.txt
// Source: https://github.com/angular/angular/blob/ecaec13db4fde7ceb0104105ee356bf00596f3d6/adev/src/app/core/services/routing/adev-url-serializer.ts#L15-L25
// Exact source lines 15–25; indentation retained.

export class AdevUrlSerializer extends DefaultUrlSerializer {
  override parse(url: string): UrlTree {
    // Since the app host/server is decoding encoded forward slashes,
    // we perform this on the client as well in order to maintain
    // a consistent behavior between the two environments and
    // avoid opening a different page on client hydration (presumably, 404).
    url = url.replaceAll(/%2(F|f)/g, '/');

    return super.parse(url);
  }
}
