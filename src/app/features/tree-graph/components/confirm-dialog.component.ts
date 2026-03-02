import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  template: `
    <dialog
      #dialog
      class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/35"
      (close)="onClose()"
    >
      <form method="dialog" class="space-y-4 p-6">
        <h2 class="text-lg font-semibold text-slate-900">{{ title() }}</h2>
        <p class="text-sm text-slate-600">{{ message() }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <button
            class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            value="cancel"
            type="submit"
          >
            Cancel
          </button>
          <button
            class="rounded-lg border border-rose-300 bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
            value="confirm"
            type="submit"
          >
            Delete
          </button>
        </div>
      </form>
    </dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
  readonly open = input(false);
  readonly title = input('Confirm');
  readonly message = input('Are you sure?');

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly dialogElement = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const dialog = this.dialogElement()?.nativeElement;
      if (!dialog) {
        return;
      }

      if (this.open()) {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });
  }

  onClose(): void {
    const dialog = this.dialogElement()?.nativeElement;
    if (!dialog) {
      return;
    }

    if (dialog.returnValue === 'confirm') {
      this.confirmed.emit();
      return;
    }

    this.cancelled.emit();
  }
}
