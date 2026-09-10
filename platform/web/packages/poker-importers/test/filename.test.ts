import { nodeKey, step } from '@poker/core';
import { describe, expect, it } from 'vitest';

import { baseName, inferFromName } from '../src/filename';

describe('inferFromName', () => {
  it('reads the spec examples with high confidence', () => {
    const rfi = inferFromName('UTG_RFI_100bb.txt');
    expect(rfi.confidence).toBe('high');
    expect(rfi.key).toEqual(nodeKey('UTG', { action_sequence: [step('UTG', 'raise')] }));

    const threeBet = inferFromName('BTN_vs_UTG_3bet.txt');
    expect(threeBet.confidence).toBe('high');
    expect(threeBet.key).toEqual(nodeKey('BTN', { villain_position: 'UTG', action_sequence: [step('UTG', 'raise'), step('BTN', 'raise')] }));

    const defend = inferFromName('BB_defend_vs_CO_2.5x.txt');
    expect(defend.confidence).toBe('high');
    expect(defend.key).toEqual(nodeKey('BB', { villain_position: 'CO', action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call')] }));
  });

  it('reads stack, stake, table and the directory-free name', () => {
    const open = inferFromName('charts/6max/HJ open 2.5bb 40bb NL5.txt');
    expect(open.confidence).toBe('high');
    expect(open.key).toEqual(nodeKey('HJ', { stake: 'NL5', eff_stack_bb: 40, action_sequence: [step('HJ', 'raise', { size_bb: 2.5 })] }));
    expect(baseName('C:\\ranges\\BTN_RFI.range.txt')).toBe('BTN_RFI.range');
  });

  it('builds the longer preflop shapes with villain first and hero last', () => {
    expect(inferFromName('CO_4bet_vs_BTN').key?.action_sequence).toEqual([step('CO', 'raise'), step('BTN', 'raise'), step('CO', 'raise')]);
    expect(inferFromName('SB 5-bet vs BB').key?.action_sequence).toEqual([step('BB', 'raise'), step('SB', 'raise'), step('BB', 'raise'), step('SB', 'raise')]);
    expect(inferFromName('BB_shove_vs_SB_3x').key?.action_sequence).toEqual([step('SB', 'raise', { size_bb: 3 }), step('BB', 'allin')]);
    expect(inferFromName('BU iso vs HJ limp').key?.action_sequence).toEqual([step('HJ', 'limp'), step('BTN', 'raise')]);
    expect(inferFromName('BB fold vs UTG').key?.action_sequence).toEqual([step('UTG', 'raise'), step('BB', 'fold')]);
  });

  it('places a size before vs on hero and after vs on villain', () => {
    const mine = inferFromName('BTN_3bet_9bb_vs_CO_2.5x');
    expect(mine.key?.action_sequence).toEqual([step('CO', 'raise', { size_bb: 2.5 }), step('BTN', 'raise', { size_bb: 9 })]);
    expect(mine.confidence).toBe('high');
  });

  it('drops to medium with a note when a needed seat or a word is missing, and to low without a position', () => {
    const alone = inferFromName('SB_3bet.txt');
    expect(alone.confidence).toBe('medium');
    expect(alone.notes).toEqual(["3bet: the opener's position is missing"]);
    expect(alone.key?.action_sequence).toEqual([step('SB', 'raise')]);

    const squeeze = inferFromName('BB_squeeze_vs_CO');
    expect(squeeze.confidence).toBe('medium');
    expect(squeeze.notes[0]).toContain('squeeze: add the caller');

    const versioned = inferFromName('BB_vs_BTN_3-bet_v2');
    expect(versioned.confidence).toBe('medium');
    expect(versioned.unrecognised).toEqual(['v2']);
    expect(versioned.key?.action_sequence).toEqual([step('BTN', 'raise'), step('BB', 'raise')]);

    const noWord = inferFromName('UTG_100bb');
    expect(noWord.confidence).toBe('low');
    expect(noWord.key).toEqual(nodeKey('UTG'));
    expect(noWord.notes[0]).toContain('no action word');

    const nothing = inferFromName('notes.txt');
    expect(nothing.confidence).toBe('low');
    expect(nothing.key).toBeNull();
    expect(nothing.unrecognised).toEqual(['notes']);
  });

  it('keeps 100bb as the stack while bb alone is the big blind seat', () => {
    const key = inferFromName('BB_call_vs_BTN_100bb').key;
    expect(key?.hero_position).toBe('BB');
    expect(key?.eff_stack_bb).toBe(100);
    expect(key?.villain_position).toBe('BTN');
  });
});
