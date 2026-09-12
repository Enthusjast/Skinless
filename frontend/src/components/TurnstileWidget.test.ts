import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TurnstileWidget from './TurnstileWidget.vue';

interface TestTurnstileApi {
  render: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function createTurnstileApi(): TestTurnstileApi {
  const api: TestTurnstileApi = {
    render: vi.fn().mockReturnValue('widget-1'),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  return api;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.head
    .querySelectorAll('script[data-skinless-turnstile]')
    .forEach((script) => script.remove());
});

describe('TurnstileWidget', () => {
  it('does not render or load a script when no site key is configured', async () => {
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    const wrapper = mount(TurnstileWidget, { props: { siteKey: '' } });
    await flushPromises();

    expect(wrapper.find('[data-turnstile-widget]').exists()).toBe(false);
    expect(appendSpy).not.toHaveBeenCalledWith(expect.any(HTMLScriptElement));
  });

  it('loads the official script, emits tokens, and resets the rendered widget', async () => {
    const api = createTurnstileApi();
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLScriptElement) {
        queueMicrotask(() => {
          vi.stubGlobal('turnstile', api);
          node.dispatchEvent(new Event('load'));
        });
      }
      return node;
    });
    const wrapper = mount(TurnstileWidget, { props: { siteKey: 'site-key' } });
    await flushPromises();

    const script = appendSpy.mock.calls
      .map(([node]) => node)
      .find((node): node is HTMLScriptElement => node instanceof HTMLScriptElement);
    expect(script?.src).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    );
    expect(api.render).toHaveBeenCalledWith(
      wrapper.get('[data-turnstile-widget]').element,
      expect.objectContaining({ sitekey: 'site-key' }),
    );

    const renderOptions = api.render.mock.calls[0]?.[1] as { callback: (token: string) => void };
    renderOptions.callback('turnstile-token');
    expect(wrapper.emitted('token')).toEqual([['turnstile-token']]);

    wrapper.vm.reset();
    expect(api.reset).toHaveBeenCalledWith('widget-1');
  });
});
