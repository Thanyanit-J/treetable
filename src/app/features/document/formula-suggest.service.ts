import { Injectable, inject, signal } from '@angular/core';
import { DocumentStoreService } from '../../core/store/document-store.service';
import { FormulaSuggestion, formulaTokenAt, suggestForToken } from './formula-suggest';

export interface FormulaSuggestState {
  left: number;
  top: number;
  minWidth: number;
  items: FormulaSuggestion[];
  activeIndex: number;
}

/**
 * Shared state for the formula autocomplete dropdown: the active formula
 * editor feeds caret/token updates in, the single overlay on the document
 * page renders whatever is current. Keyboard handling stays in the editors —
 * they offer keys to `move`/`accept`/`closeIfOpen` first and fall back to
 * their own behavior when the dropdown is closed.
 */
@Injectable({ providedIn: 'root' })
export class FormulaSuggestService {
  private readonly store = inject(DocumentStoreService);

  private input: HTMLInputElement | null = null;
  private topicId: string | null = null;

  readonly state = signal<FormulaSuggestState | null>(null);

  /** Binds the dropdown to a formula editor input (idempotent). */
  attach(topicId: string, input: HTMLInputElement): void {
    this.topicId = topicId;
    this.input = input;
    this.refresh();
  }

  /** Releases the dropdown (any editor's teardown may call this). */
  detach(): void {
    this.input = null;
    this.topicId = null;
    this.state.set(null);
  }

  /** Opens the dropdown on demand (Ctrl/Cmd+I), even on an empty token. */
  toggle(): void {
    if (!this.closeIfOpen()) {
      this.refresh(true);
    }
  }

  /** Recomputes suggestions for the token at the current caret. */
  refresh(force = false): void {
    const input = this.input;
    if (!input || !this.topicId || !input.isConnected) {
      this.state.set(null);
      return;
    }
    const caret = input.selectionStart ?? input.value.length;
    if (caret !== (input.selectionEnd ?? caret)) {
      this.state.set(null); // A selection is about to be replaced — no token.
      return;
    }
    const at = formulaTokenAt(input.value, caret);
    const items =
      at && (force || at.token.length > 0)
        ? suggestForToken(this.store.document(), this.topicId, at.token)
        : [];
    if (items.length === 0) {
      this.state.set(null);
      return;
    }
    const rect = input.getBoundingClientRect();
    this.state.set({
      left: rect.left,
      top: rect.bottom + 2,
      minWidth: Math.max(rect.width, 180),
      items,
      activeIndex: 0,
    });
  }

  /** Arrow navigation; true when the dropdown consumed the key. */
  move(delta: number): boolean {
    const state = this.state();
    if (!state) {
      return false;
    }
    const activeIndex = (state.activeIndex + delta + state.items.length) % state.items.length;
    this.state.set({ ...state, activeIndex });
    return true;
  }

  /** Applies the active (or clicked) suggestion; true when one was applied. */
  accept(index?: number): boolean {
    const state = this.state();
    const input = this.input;
    if (!state || !input) {
      return false;
    }
    const item = state.items[index ?? state.activeIndex];
    if (!item) {
      return false;
    }

    const caret = input.selectionStart ?? input.value.length;
    const at = formulaTokenAt(input.value, caret);
    if (!at) {
      return false;
    }
    // Only the last segment is completed; qualifiers before the dot stay.
    const lastDot = at.token.lastIndexOf('.');
    const segmentStart = at.start + (lastDot >= 0 ? lastDot + 1 : 0);
    const nextCaret = segmentStart + item.insert.length + item.caretShift;
    input.value = input.value.slice(0, segmentStart) + item.insert + input.value.slice(caret);
    input.setSelectionRange(nextCaret, nextCaret);
    input.focus();
    this.refresh();
    return true;
  }

  /** Closes if open; true when it was open (first Escape eats the dropdown). */
  closeIfOpen(): boolean {
    if (this.state() === null) {
      return false;
    }
    this.state.set(null);
    return true;
  }
}
