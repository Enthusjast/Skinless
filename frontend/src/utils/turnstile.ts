export const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

export interface TurnstileApi {
  render(element: HTMLElement, options: TurnstileRenderOptions): string | number;
  reset(widgetId?: string | number): void;
  remove?(widgetId?: string | number): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

export function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined')
    return Promise.reject(new Error('Turnstile requires a browser.'));
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-skinless-turnstile]');
    const script = existing ?? document.createElement('script');
    const finish = () => {
      if (window.turnstile) resolve();
      else reject(new Error('Turnstile loaded without its API.'));
    };
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Turnstile failed to load.')), {
      once: true,
    });
    if (existing) return;

    script.async = true;
    script.defer = true;
    script.src = TURNSTILE_SCRIPT_URL;
    script.dataset.skinlessTurnstile = 'true';
    document.head.appendChild(script);
  });

  return scriptPromise;
}
