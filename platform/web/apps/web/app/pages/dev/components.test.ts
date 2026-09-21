/**
 * The gallery is the whole of `@poker/ui`, not most of it (spec §12: every component in isolation
 * with fixture props; ADR-024 reviews components on a fixture page).
 *
 * It had drifted to 28 of the package's 36 — eight components with README examples and no slot —
 * and nothing was red. This reads the package's own export list and the page's markup, so a
 * component exported without a slot here fails the suite rather than going unreviewable
 * (ADR-061). The same shape as `shortcuts.test.ts`, which pins the `?` overlay to the key
 * handlers that exist.
 *
 * **What this is and is not.** It is a static check on the source: every exported component has a
 * tag and an import on the page. It does not prove the tag renders — two sections are behind a
 * `v-if` on the equity result, as they have to be. That the page really draws all of them is
 * checked by opening it, which is what the page is for.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const UI_INDEX = fileURLToPath(new URL('../../../../../packages/poker-ui/src/index.ts', import.meta.url));
const PAGE = fileURLToPath(new URL('./components.vue', import.meta.url));

/** Every `export { default as X } from './components/X.vue'` — the package's component surface. */
function exportedComponents(): string[] {
  const source = readFileSync(UI_INDEX, 'utf8');
  return [...source.matchAll(/export \{ default as (\w+) \} from '\.\/components\//g)].map((match) => match[1]!);
}

describe('/dev/components', () => {
  it('reads a component surface to check against', () => {
    // A rename in poker-ui's index that stopped the regex matching would otherwise pass silently.
    expect(exportedComponents().length).toBeGreaterThan(30);
  });

  it('gives every component @poker/ui exports a slot on the page', () => {
    const page = readFileSync(PAGE, 'utf8');
    const missing = exportedComponents().filter((name) => !new RegExp(`<${name}[\\s/>]`).test(page));
    expect(missing).toEqual([]);
  });

  it('imports each of them by name rather than relying on a global', () => {
    const imports = /import \{([^}]*)\} from '@poker\/ui'/.exec(readFileSync(PAGE, 'utf8'))?.[1] ?? '';
    const named = new Set(imports.split(',').map((part) => part.trim()));
    expect(exportedComponents().filter((name) => !named.has(name))).toEqual([]);
  });
});
