let lockCount = 0;

const blockedKeys = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
  'Spacebar',
]);

const preventDefault = (event: Event): void => {
  event.preventDefault();
};

const preventScrollKeys = (event: KeyboardEvent): void => {
  if (blockedKeys.has(event.key)) {
    event.preventDefault();
  }
};

export function acquireMenuScrollLock(): void {
  lockCount += 1;
  if (lockCount !== 1) {
    return;
  }

  window.addEventListener('wheel', preventDefault, { passive: false });
  window.addEventListener('touchmove', preventDefault, { passive: false });
  window.addEventListener('keydown', preventScrollKeys, { passive: false });
}

export function releaseMenuScrollLock(): void {
  if (lockCount === 0) {
    return;
  }

  lockCount -= 1;
  if (lockCount !== 0) {
    return;
  }

  window.removeEventListener('wheel', preventDefault);
  window.removeEventListener('touchmove', preventDefault);
  window.removeEventListener('keydown', preventScrollKeys);
}
