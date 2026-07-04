import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * Editor for an entity's Reference Name (ADR-0003). Saving rewrites every
 * referencing formula in the Document atomically; validation errors from the
 * store are shown inline and keep the dialog open.
 */
@Component({
  selector: 'app-ref-name-dialog',
  template: `
    <dialog
      #dialog
      class="m-auto w-[min(26rem,90vw)] rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-900/40"
      (close)="onClosed()"
      aria-labelledby="refname-title"
    >
      <form class="p-5" (submit)="onSubmit($event)">
        <h2 id="refname-title" class="text-base font-semibold text-slate-900">
          Reference name for “{{ displayName() }}”
        </h2>
        <p class="mt-1 text-sm text-slate-600">
          Formulas address this {{ kind() }} by its reference name. Renaming rewrites every formula
          that uses it.
        </p>
        <input
          #refInput
          class="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-800 focus-visible:outline-2 focus-visible:outline-sky-600"
          [attr.aria-label]="'Reference name for ' + displayName()"
          [attr.aria-invalid]="errorMessage() ? 'true' : null"
          autocomplete="off"
          spellcheck="false"
        />
        @if (errorMessage(); as message) {
          <p class="mt-2 text-sm text-rose-700" role="alert">{{ message }}</p>
        } @else {
          <p class="mt-2 text-xs text-slate-400">
            {{
              kind() === 'column'
                ? 'Like $Amount — starts with $.'
                : 'Like Savings — letters, digits, _.'
            }}
          </p>
        }
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            (click)="cancelled.emit()"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            Rename
          </button>
        </div>
      </form>
    </dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefNameDialogComponent {
  readonly open = input(false);
  readonly kind = input<'topic' | 'node' | 'column'>('node');
  readonly displayName = input('');
  readonly currentRefName = input('');
  readonly errorMessage = input<string | null>(null);

  readonly save = output<string>();
  readonly cancelled = output<void>();

  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('refInput');

  constructor() {
    effect(() => {
      const dialog = this.dialogRef().nativeElement;
      if (this.open()) {
        if (!dialog.open) {
          this.inputRef().nativeElement.value = this.currentRefName();
          dialog.showModal();
          this.inputRef().nativeElement.select();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.save.emit(this.inputRef().nativeElement.value);
  }

  protected onClosed(): void {
    if (this.open()) {
      this.cancelled.emit();
    }
  }
}
