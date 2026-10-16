// Await the exact module already requested by the page, without reactivation or
// a test-only global. The module map shares evaluation, including authored TLA.
export async function awaitPageModules(page, urls, timeout) {
  await page.evaluate(async ({urls, timeout}) => {
    let timer;
    try {
      await Promise.race([
        Promise.all(urls.map(url => import(url))),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('entry module evaluation did not complete')), timeout); }),
      ]);
    } finally { clearTimeout(timer); }
  }, {urls, timeout});
}
