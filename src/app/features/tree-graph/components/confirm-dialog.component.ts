import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  template: `
    <dialog
      #dialog
      class="fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/35"
      (close)="onClose()"
      (keydown)="onDialogKeyDown($event)"
    >
      <form method="dialog" class="space-y-4 p-6">
        @if (titleLabel()) {
          <h2 class="flex min-w-0 items-baseline text-lg font-semibold text-slate-900">
            <span class="shrink-0">Delete "</span>
            <span class="min-w-0 truncate" [attr.title]="titleLabel()">{{ titleLabel() }}</span>
            <span class="shrink-0">" node?</span>
          </h2>
        } @else {
          <h2 class="block max-w-full truncate text-lg font-semibold text-slate-900" [attr.title]="title()">{{ title() }}</h2>
        }
        <p class="text-sm text-slate-600">{{ message() }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <button
            #cancelButton
            class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            value="cancel"
            type="submit"
          >
            Cancel
          </button>
          @if (secondaryConfirmLabel()) {
            <button
              #secondaryConfirmButton
              class="rounded-lg border border-amber-300 bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
              value="confirm-secondary"
              type="submit"
            >
              {{ secondaryConfirmLabel() }}
            </button>
          }
          <button
            #confirmButton
            class="rounded-lg border border-rose-300 bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
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
  readonly titleLabel = input('');
  readonly message = input('Are you sure?');
  readonly secondaryConfirmLabel = input('');

  readonly confirmed = output<void>();
  readonly secondaryConfirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly dialogElement = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelButtonElement = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  private readonly secondaryConfirmButtonElement = viewChild<ElementRef<HTMLButtonElement>>('secondaryConfirmButton');
  private readonly confirmButtonElement = viewChild<ElementRef<HTMLButtonElement>>('confirmButton');

  constructor() {
    effect(() => {
      const dialog = this.dialogElement()?.nativeElement;
      if (!dialog) {
        return;
      }

      if (this.open()) {
        if (!dialog.open) {
          dialog.showModal();
          queueMicrotask(() => {
            this.confirmButtonElement()?.nativeElement.focus();
          });
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

    if (dialog.returnValue === 'confirm-secondary') {
      this.secondaryConfirmed.emit();
      return;
    }

    if (dialog.returnValue === 'confirm') {
      this.confirmed.emit();
      return;
    }

    this.cancelled.emit();
  }

  onDialogKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    const cancelButton = this.cancelButtonElement()?.nativeElement;
    const secondaryButton = this.secondaryConfirmButtonElement()?.nativeElement;
    const confirmButton = this.confirmButtonElement()?.nativeElement;
    if (!cancelButton || !confirmButton) {
      return;
    }

    const orderedButtons = [cancelButton, secondaryButton, confirmButton].filter(
      (button): button is HTMLButtonElement => button instanceof HTMLButtonElement,
    );
    if (orderedButtons.length < 2) {
      return;
    }

    event.preventDefault();
    const activeElement = document.activeElement;
    const currentIndex = orderedButtons.indexOf(activeElement as HTMLButtonElement);
    const move = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (currentIndex + move + orderedButtons.length) % orderedButtons.length;
    const nextButton = orderedButtons[nextIndex];
    nextButton?.focus();
  }
}
