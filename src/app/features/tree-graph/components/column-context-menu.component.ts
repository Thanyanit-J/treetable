import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

@Component({
  selector: 'app-column-context-menu',
  host: {
    '(document:keydown.escape)': 'onEscape()',
    '(document:mousedown)': 'onDocumentMouseDown($event)',
  },
  template: `
    @if (open()) {
      <section
        #menu
        class="fixed z-50 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
        [style.left.px]="x()"
        [style.top.px]="y()"
        role="menu"
        aria-label="Column actions"
      >
        <button
          (click)="action.emit('insertLeft')"
          class="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
          role="menuitem"
          type="button"
        >
          Insert column left
        </button>
        <button
          (click)="action.emit('insertRight')"
          class="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
          role="menuitem"
          type="button"
        >
          Insert column right
        </button>
        <button
          (click)="action.emit('rename')"
          class="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
          role="menuitem"
          type="button"
        >
          Rename column
        </button>
        <button
          (click)="action.emit('delete')"
          [disabled]="!canDelete()"
          class="block w-full rounded px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          role="menuitem"
          type="button"
        >
          Delete column
        </button>
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColumnContextMenuComponent {
  readonly open = input(false);
  readonly x = input(0);
  readonly y = input(0);
  readonly canDelete = input(true);

  readonly action = output<'insertLeft' | 'insertRight' | 'rename' | 'delete'>();
  readonly close = output<void>();

  private readonly menuRef = viewChild<ElementRef<HTMLElement>>('menu');

  constructor() {
    effect(() => {
      if (!this.open()) {
        return;
      }

      queueMicrotask(() => {
        this.menuRef()?.nativeElement.querySelector('button')?.focus();
      });
    });
  }

  onEscape(): void {
    if (this.open()) {
      this.close.emit();
    }
  }

  onDocumentMouseDown(event: MouseEvent): void {
    if (!this.open()) {
      return;
    }

    const menu = this.menuRef()?.nativeElement;
    const target = event.target as Node | null;
    if (!menu || !target || menu.contains(target)) {
      return;
    }

    this.close.emit();
  }
}
