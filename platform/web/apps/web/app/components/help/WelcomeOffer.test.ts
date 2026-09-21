// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import type { HelpSession } from '~/help/state';
import { createHelpSession } from '~/help/state';
import { EXAMPLES } from '~/help/examples';
import { TOUR_STOPS } from '~/help/tour';

import WelcomeOffer from './WelcomeOffer.vue';

const help = vi.hoisted(() => ({ session: null as HelpSession | null }));
vi.mock('~/help/useHelp', () => ({ useHelp: () => help.session }));

/** A `NuxtLink` for a test with no Nuxt: an anchor that keeps the target and passes clicks on. */
const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots, attrs }) => () => h('a', { ...attrs, href: props.to }, slots.default?.()),
});

const navigateTo = vi.fn();

function offer() {
  return mount(WelcomeOffer, { props: { stops: TOUR_STOPS, examples: EXAMPLES }, global: { components: { NuxtLink } } });
}

describe('WelcomeOffer', () => {
  beforeEach(() => {
    help.session = createHelpSession(null);
    navigateTo.mockReset();
    vi.stubGlobal('navigateTo', navigateTo);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('offers the tour and every example, each opening its own page', () => {
    const w = offer();
    expect(w.find('[data-testid="welcome-tour"]').text()).toContain(`${TOUR_STOPS.length} stops`);
    const links = w.findAll('[data-testid^="welcome-example-"]');
    expect(links.map((link) => link.attributes('href'))).toEqual(EXAMPLES.map((e) => `/examples/${e.id}`));
    expect(links[0]!.text()).toContain(EXAMPLES[0]!.title);
  });

  it('starts the tour at its first stop, which answers the offer', async () => {
    await offer().find('[data-testid="welcome-tour"]').trigger('click');
    expect(help.session!.state.value).toMatchObject({ welcomed: true, tour: 'running', stop: 0 });
    expect(navigateTo).toHaveBeenCalledWith(TOUR_STOPS[0]!.route);
  });

  it('is answered by taking an example, and by saying no', async () => {
    await offer().find(`[data-testid="welcome-example-${EXAMPLES[1]!.id}"]`).trigger('click');
    expect(help.session!.state.value).toMatchObject({ welcomed: true, tour: 'unseen' });

    help.session = createHelpSession(null);
    await offer().find('[data-testid="welcome-dismiss"]').trigger('click');
    expect(help.session.state.value).toMatchObject({ welcomed: true, tour: 'unseen' });
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
