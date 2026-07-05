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
 * Confirmation dialog built on the native <dialog> element: modal focus trap,
 * Escape handling and inert background come from the platform.
 */
@Component({
  selector: 'app-confirm-dialog',
  template: `
    <dialog
      #dialog
      class="m-auto w-[min(28rem,90vw)] rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-900/40"
      (close)="onClosed()"
      aria-labelledby="confirm-title"
    >
      <div class="p-5">
        <h2 id="confirm-title" class="text-base font-semibold text-slate-900">{{ title() }}</h2>
        <p class="mt-2 text-sm text-slate-600">{{ message() }}</p>
        <div class="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            autofocus
            class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            (click)="cancelled.emit()"
          >
            Cancel
          </button>
          @if (secondaryLabel()) {
            <button
              type="button"
              class="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
              (click)="secondaryConfirmed.emit()"
            >
              {{ secondaryLabel() }}
            </button>
          }
          <button
            type="button"
            class="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
            (click)="confirmed.emit()"
          >
            {{ confirmLabel() }}
          </button>
        </div>
      </div>
    </dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
  readonly open = input(false);
  readonly title = input('Confirm');
  readonly message = input('');
  readonly confirmLabel = input('Delete');
  readonly secondaryLabel = input('');

  readonly confirmed = output<void>();
  readonly secondaryConfirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const dialog = this.dialogRef().nativeElement;
      if (this.open()) {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });
  }

  /** Fires for every close, including Escape; only user-initiated closes cancel. */
  protected onClosed(): void {
    if (this.open()) {
      this.cancelled.emit();
    }
  }
}
