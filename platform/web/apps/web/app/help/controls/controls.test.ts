import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONTROLS, controlById, tipId } from './index';

const WORKSPACE = fileURLToPath(new URL('../../../../../', import.meta.url));
const SCANNED = ['packages/poker-ui/src/components', 'apps/web/app'];

/**
 * The controls F.13 contracted to explain. Written down so that deleting an entry fails here
 * with the name of what stopped being explained, rather than quietly shrinking the coverage.
 */
const CONTRACTED = [
  'dataset',
  'groupby-picker',
  'stat-picker',
  'preset-menu',
  'min-n',
  'situation-builder',
  'situation-chips',
  'compare-columns',
  'replay-transport',
  'study-node',
  'stepper',
  'prediction-gate',
  'train-modes',
  'import-apply-all',
  'upload-drop',
  'upload-list',
  'cohort-rules',
  'range-matrix',
];

/**
 * Choosers whose own label is the whole explanation, and why each may stay unexplained. The
 * sweep below fails on any `<select>` that is neither in `CONTROLS` nor in here, so a new one
 * cannot arrive unexplained by accident — only on purpose, with the reason written down.
 */
const SELF_EVIDENT: Record<string, string> = {
  'clause-bucket': 'the options are the bands the registry named, each already explained where it is read',
  'clause-enum': 'the options are the values themselves',
  'accounts-site': 'the poker room a screen name belongs to; the label is the question',
  'upload-site': 'the poker room the files come from; locked while sending, which the lock line says',
  'replay-speed': 'how fast play runs; the options are seconds',
  'node-hero': 'one box of the situation editor, explained as a whole at node-label',
  'node-villain': 'one box of the situation editor, explained as a whole at node-label',
  'node-street': 'one box of the situation editor, explained as a whole at node-label',
  'report-groupby': 'the developer filter playground, which is not a tool',
};

/** The identifying token of an anchor: the testid, the testid prefix, or the class name. */
function token(anchor: string): string {
  const testid = /\[data-testid\^?="([^"]+)"\]/.exec(anchor);
  if (testid !== null) return testid[1]!;
  const className = /^\.([\w-]+)$/.exec(anchor);
  if (className === null) throw new Error(`anchor is neither a testid nor a class: ${anchor}`);
  return className[1]!;
}

function vueFiles(): string[] {
  return SCANNED.flatMap((root) =>
    readdirSync(join(WORKSPACE, root), { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.vue'))
      .map((file) => `${root}/${file}`),
  );
}

/** Every `<select>` that carries a `data-testid`, as `testid → file:line`. */
function choosers(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of vueFiles()) {
    const lines = readFileSync(join(WORKSPACE, file), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (!line.includes('<select')) continue;
      const id = /data-testid="([^"`$]+)"/.exec(line);
      if (id !== null) found.set(id[1]!, `${file}:${index + 1}`);
    }
  }
  return found;
}

describe('the control help', () => {
  it('points only at files that exist, and at an anchor each of them really renders', () => {
    for (const control of CONTROLS) {
      expect(existsSync(join(WORKSPACE, control.source)), control.source).toBe(true);
      const source = readFileSync(join(WORKSPACE, control.source), 'utf8');
      expect(source.includes(token(control.anchor)), `${control.id} → ${control.anchor} in ${control.source}`).toBe(true);
    }
  });

  it('gives every control a name, a sentence and a place, with no id or anchor used twice', () => {
    expect(new Set(CONTROLS.map((control) => control.id)).size).toBe(CONTROLS.length);
    expect(new Set(CONTROLS.map((control) => control.anchor)).size).toBe(CONTROLS.length);
    for (const control of CONTROLS) {
      for (const field of [control.control, control.does, control.where]) expect(field.trim(), control.id).not.toBe('');
      expect(control.does.length, control.id).toBeGreaterThan(40);
      expect(controlById(control.id), control.id).toBe(control);
      expect(tipId(control.id)).toBe(`control-help-${control.id}`);
    }
  });

  it('still explains every control the step contracted to explain', () => {
    expect(CONTRACTED.filter((id) => controlById(id) === null)).toEqual([]);
  });

  it('explains every chooser in the app, or says in writing why it needs none', () => {
    const anchored = new Set(CONTROLS.map((control) => token(control.anchor)));
    const prefixes = CONTROLS.map((control) => token(control.anchor)).filter((value) => value.endsWith('-'));
    const unexplained = [...choosers()]
      .filter(([id]) => !anchored.has(id) && !prefixes.some((prefix) => id.startsWith(prefix)))
      .filter(([id]) => SELF_EVIDENT[id] === undefined)
      .map(([id, where]) => `${id} (${where})`);
    expect(unexplained).toEqual([]);
  });

  it('keeps the self-evident list honest: every reason names a chooser that is still there', () => {
    const present = choosers();
    for (const [id, reason] of Object.entries(SELF_EVIDENT)) {
      expect(present.has(id), `${id} is no longer a chooser; drop its reason`).toBe(true);
      expect(reason.trim(), id).not.toBe('');
    }
  });
});
