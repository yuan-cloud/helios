/* eslint-disable no-restricted-globals */
(() => {
  const COOP = 'same-origin';
  const COEP = 'require-corp';

  async function addHeadersToResponse(response) {
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Cross-Origin-Opener-Policy', COOP);
    newHeaders.set('Cross-Origin-Embedder-Policy', COEP);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  async function handleFetch(event) {
    const request = event.request;

    const requestURL = new URL(request.url);
    if (requestURL.origin !== self.location.origin) {
      return;
    }

    if (
      request.mode === 'navigate' ||
      request.destination === 'script' ||
      request.destination === 'style' ||
      request.destination === 'worker' ||
      request.destination === 'sharedworker' ||
      request.destination === 'document'
    ) {
      event.respondWith(
        fetch(request, {
          credentials: 'same-origin',
        }).then(addHeadersToResponse)
      );
    }
  }

  function setupServiceWorkerContext() {
    self.addEventListener('install', (event) => {
      event.waitUntil(self.skipWaiting());
    });

    self.addEventListener('activate', (event) => {
      event.waitUntil(
        (async () => {
          if (self.registration.navigationPreload) {
            await self.registration.navigationPreload.disable();
          }
          await self.clients.claim();
        })()
      );
    });

    self.addEventListener('fetch', handleFetch);
  }

  async function registerSelf(scriptUrl) {
    try {
      const registration = await navigator.serviceWorker.register(scriptUrl, {
        scope: './',
      });

      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          const reload = () => {
            window.location.reload();
            resolve();
          };

          setTimeout(reload, 50);
        });
      } else {
        await navigator.serviceWorker.ready;
      }

      return registration;
    } catch (error) {
      console.warn('coi-serviceworker: registration failed', error);
      return null;
    }
  }

  function setupWindowContext() {
    if (!navigator.serviceWorker) {
      return;
    }

    const currentScript =
      document.currentScript || document.querySelector('script[src$="coi-serviceworker.js"]');

    if (!currentScript) {
      console.warn('coi-serviceworker: unable to determine current script URL');
      return;
    }

    const scriptUrl = new URL(currentScript.src, window.location.href);

    registerSelf(scriptUrl.href);
  }

  if (typeof window === 'undefined') {
    setupServiceWorkerContext();
  } else {
    setupWindowContext();
  }
})();


