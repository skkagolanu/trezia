import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

type FetchEvent = {
  request: Request;
  respondWith: (response: Promise<Response>) => void;
};

function loadFetchHandler(fetch: jest.Mock, cache: { match: jest.Mock; put: jest.Mock }) {
  let fetchHandler: ((event: FetchEvent) => void) | undefined;
  const self = {
    location: { origin: 'https://trezia.test' },
    addEventListener: (type: string, handler: (event: FetchEvent) => void) => {
      if (type === 'fetch') fetchHandler = handler;
    },
    skipWaiting: jest.fn(),
    clients: { claim: jest.fn() },
  };
  const caches = {
    open: jest.fn(async () => cache),
    keys: jest.fn(async () => []),
    match: jest.fn(),
    delete: jest.fn(),
  };
  const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
  vm.runInNewContext(source, { self, caches, fetch, URL, Promise });
  if (!fetchHandler) throw new Error('Service worker did not register a fetch handler');
  return fetchHandler;
}

describe('service-worker static cache writes', () => {
  it.each([
    ['a failed same-origin response', 'https://trezia.test/_next/static/app.js', 500],
    ['a redirect same-origin response', 'https://trezia.test/_next/static/app.js', 302],
    ['a successful cross-origin response', 'https://cdn.example.test/_next/static/app.js', 200],
  ])('does not cache %s', async (_case, url, status) => {
    const cache = { match: jest.fn(async () => undefined), put: jest.fn() };
    const fetch = jest.fn(async () => new Response('asset', { status }));
    const handler = loadFetchHandler(fetch, cache);
    let responsePromise: Promise<Response> | undefined;

    handler({ request: new Request(url), respondWith: response => { responsePromise = response; } });

    if (responsePromise) await responsePromise;
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('caches a successful same-origin static response', async () => {
    const cache = { match: jest.fn(async () => undefined), put: jest.fn() };
    const fetch = jest.fn(async () => new Response('asset', { status: 200 }));
    const handler = loadFetchHandler(fetch, cache);
    const request = new Request('https://trezia.test/_next/static/app.js');
    let responsePromise: Promise<Response> | undefined;

    handler({ request, respondWith: response => { responsePromise = response; } });

    await responsePromise;
    expect(cache.put).toHaveBeenCalledWith(request, expect.any(Response));
  });
});
