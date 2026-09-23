// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PokerAccount, UploadsApi } from '~/upload/api';

import PokerAccounts from './PokerAccounts.vue';

const SITES = ['ggpoker', 'pokerstars'];

/** An in-memory server holding one user's screen names. */
function fakeApi(over: Partial<UploadsApi> = {}) {
  let rows: PokerAccount[] = [];
  let nextId = 1;
  const calls: string[] = [];
  const api: UploadsApi = {
    sites: async () => SITES,
    list: async () => [],
    get: async () => {
      throw new Error('not used here');
    },
    upload: async () => {
      throw new Error('not used here');
    },
    accounts: async () => {
      calls.push('list');
      return [...rows];
    },
    addAccount: async (site, screenName) => {
      calls.push(`add:${site}:${screenName}`);
      if (rows.some((row) => row.site === site && row.screen_name === screenName)) {
        throw { status: 409, data: { detail: `'${screenName}' is already one of your ${site} screen names.` } };
      }
      const row = { id: `a${nextId++}`, site, screen_name: screenName, is_verified: false };
      rows.push(row);
      return row;
    },
    removeAccount: async (id) => {
      calls.push(`remove:${id}`);
      rows = rows.filter((row) => row.id !== id);
    },
    ...over,
  };
  return { api, calls, seed: (seeded: PokerAccount[]) => (rows = seeded) };
}

const HERO: PokerAccount = { id: 'a9', site: 'pokerstars', screen_name: 'Hero', is_verified: false };

const find = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-testid="${id}"]`);

/** happy-dom has no `window.confirm`; answer it the way the test needs. */
function stubConfirm(answer: boolean) {
  const confirm = vi.fn(() => answer);
  vi.stubGlobal('confirm', confirm);
  return confirm;
}

async function typeAndAdd(w: ReturnType<typeof mount>, site: string, name: string): Promise<void> {
  await find(w, 'accounts-site').setValue(site);
  await find(w, 'accounts-name').setValue(name);
  await w.find('form').trigger('submit');
  await flushPromises();
}

describe('PokerAccounts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says the list could not be loaded when it could not', async () => {
    const { api } = fakeApi({
      accounts: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const w = mount(PokerAccounts, { props: { api, sites: SITES } });
    await flushPromises();
    expect(find(w, 'accounts-error').text()).toBe('Could not load your screen names: The API did not answer. Start it with `make api` in platform/ and try again.');
    expect(find(w, 'accounts-empty').exists()).toBe(false);
  });

  it('recovers from a failed first load: after an add and a remove the list reads as empty, not loading', async () => {
    stubConfirm(true);
    const { api } = fakeApi();
    let first = true;
    const flaky: UploadsApi = {
      ...api,
      accounts: async () => {
        if (first) {
          first = false;
          throw { status: 502 };
        }
        return api.accounts();
      },
    };
    const w = mount(PokerAccounts, { props: { api: flaky, sites: SITES } });
    await flushPromises();
    expect(find(w, 'accounts-error').exists()).toBe(true);
    expect(find(w, 'accounts-loading').exists()).toBe(false);

    await typeAndAdd(w, 'pokerstars', 'Hero');
    expect(find(w, 'account-row-a1').text()).toContain('Hero');
    expect(find(w, 'accounts-error').exists()).toBe(false);

    await find(w, 'account-remove-a1').trigger('click');
    expect(find(w, 'accounts-loading').exists()).toBe(false);
    expect(find(w, 'account-row-a1').exists()).toBe(true);
    await flushPromises();
    expect(find(w, 'accounts-empty').text()).toBe('No screen names yet.');
    expect(find(w, 'accounts-loading').exists()).toBe(false);
  });

  it("shows the server's refusal of a name already there and keeps what was typed", async () => {
    const { api, seed } = fakeApi();
    seed([{ ...HERO }]);
    const w = mount(PokerAccounts, { props: { api, sites: SITES } });
    await flushPromises();
    await typeAndAdd(w, 'pokerstars', 'Hero');
    expect(find(w, 'accounts-error').text()).toBe("'Hero' is already one of your pokerstars screen names.");
    expect((find(w, 'accounts-name').element as HTMLInputElement).value).toBe('Hero');
  });

  it("joins a 422's list of problems into one sentence", async () => {
    const { api } = fakeApi({
      addAccount: async () => {
        throw { status: 422, data: { detail: [{ loc: ['body', 'site'], msg: "Unknown site 'partypoker'" }] } };
      },
    });
    const w = mount(PokerAccounts, { props: { api, sites: SITES } });
    await flushPromises();
    await typeAndAdd(w, 'ggpoker', 'someone');
    expect(find(w, 'accounts-error').text()).toBe("site: Unknown site 'partypoker'");
  });

  it('words a failed remove and a failed read-back differently', async () => {
    stubConfirm(true);
    const refused = fakeApi({
      removeAccount: async () => {
        throw { status: 404, data: { detail: 'Poker account not found' } };
      },
    });
    refused.seed([{ ...HERO }]);
    const a = mount(PokerAccounts, { props: { api: refused.api, sites: SITES } });
    await flushPromises();
    await find(a, 'account-remove-a9').trigger('click');
    await flushPromises();
    expect(find(a, 'accounts-error').text()).toBe('Could not remove Hero: Poker account not found');
    expect(refused.calls).toEqual(['list']);

    let reads = 0;
    const unread = fakeApi();
    unread.seed([{ ...HERO }]);
    const flaky: UploadsApi = {
      ...unread.api,
      accounts: async () => {
        reads += 1;
        if (reads > 1) throw { status: 500 };
        return unread.api.accounts();
      },
    };
    const b = mount(PokerAccounts, { props: { api: flaky, sites: SITES } });
    await flushPromises();
    await find(b, 'account-remove-a9').trigger('click');
    await flushPromises();
    // The bare-5xx sentence was reworded in `auth/api.ts`: a refusal under load is asked again.
    expect(find(b, 'accounts-error').text()).toBe(
      'The change was saved, but the list could not be read back: The API failed while answering this; the reason is in the terminal running `make api`. Reload the page once it has been fixed.',
    );
  });

  it('removes nothing when the confirmation is declined', async () => {
    const confirm = stubConfirm(false);
    const { api, calls, seed } = fakeApi();
    seed([{ ...HERO }]);
    const w = mount(PokerAccounts, { props: { api, sites: SITES } });
    await flushPromises();
    await find(w, 'account-remove-a9').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith('Remove Hero on pokerstars? Files already uploaded keep the seat they were given.');
    expect(calls).toEqual(['list']);
    expect(find(w, 'account-row-a9').text()).toContain('Hero');
  });

  it('keeps Add shut until there is a name, and picks a site once the sites arrive', async () => {
    const { api } = fakeApi();
    const w = mount(PokerAccounts, { props: { api, sites: [] } });
    await flushPromises();
    await find(w, 'accounts-name').setValue('   ');
    expect(find(w, 'accounts-add').attributes('disabled')).toBeDefined();

    await w.setProps({ sites: SITES });
    expect((find(w, 'accounts-site').element as HTMLSelectElement).value).toBe('ggpoker');
    await find(w, 'accounts-name').setValue('villain_1');
    expect(find(w, 'accounts-add').attributes('disabled')).toBeUndefined();
  });

  it('adds a name, reads the list back, and removes it again after confirming', async () => {
    stubConfirm(true);
    const { api, calls } = fakeApi();
    const w = mount(PokerAccounts, { props: { api, sites: SITES } });
    await flushPromises();
    expect(find(w, 'accounts-empty').text()).toBe('No screen names yet.');

    await typeAndAdd(w, 'pokerstars', '  Hero ');
    expect(calls).toEqual(['list', 'add:pokerstars:Hero', 'list']);
    expect(find(w, 'account-row-a1').text()).toContain('Hero');
    expect((find(w, 'accounts-name').element as HTMLInputElement).value).toBe('');
    expect(find(w, 'accounts-error').exists()).toBe(false);

    await find(w, 'account-remove-a1').trigger('click');
    await flushPromises();
    expect(calls).toEqual(['list', 'add:pokerstars:Hero', 'list', 'remove:a1', 'list']);
    expect(find(w, 'accounts-empty').exists()).toBe(true);
  });
});
