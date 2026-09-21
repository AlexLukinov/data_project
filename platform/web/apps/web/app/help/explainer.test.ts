import { describe, expect, it } from 'vitest';

import { attachedControls, clearHighlight, explainerRequests, highlightControl, highlightedControl, openExplainer, setAttachedControls } from './explainer';

describe('the explainer signals', () => {
  it('counts a request rather than holding a flag, so two asks in a row both arrive', () => {
    const before = explainerRequests.value;
    openExplainer();
    openExplainer();
    expect(explainerRequests.value).toBe(before + 2);
  });

  it('carries the control to point at, and forgets it when it has been pointed at', () => {
    highlightControl('min-n');
    expect(highlightedControl.value).toBe('min-n');
    clearHighlight();
    expect(highlightedControl.value).toBe('');
  });

  it('replaces the attached list only when it has actually changed', () => {
    setAttachedControls(['a', 'b']);
    const first = attachedControls.value;
    setAttachedControls(['a', 'b']);
    expect(attachedControls.value).toBe(first);
    setAttachedControls(['a']);
    expect(attachedControls.value).toEqual(['a']);
  });
});
