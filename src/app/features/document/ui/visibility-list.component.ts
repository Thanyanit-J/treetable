import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

export interface VisibilityItem {
  id: string;
  label: string;
  /** Tree depth for node lists; 0 = flush left. */
  indent?: number;
}

/**
 * Shared Visible/Hidden manager for the Details panel. The right-side
 * checkboxes only build a selection — nothing moves until "Hide selected" /
 * "Show selected", which the parent applies as one undo step; Cancel clears
 * the selection. Drag grips reorder the Visible section when `reorderable`.
 */
@Component({
  selector: 'app-visibility-list',
  imports: [CdkDrag, CdkDragHandle, CdkDropList],
  template: `
    <p class="list-heading">Visible</p>
    <div cdkDropList [cdkDropListDisabled]="!reorderable()" (cdkDropListDropped)="onDrop($event)">
      @for (item of visible(); track item.id) {
        <div cdkDrag [cdkDragData]="item.id" class="flex items-center">
          @if (reorderable()) {
            <button
              cdkDragHandle
              type="button"
              class="flex h-5 w-4 shrink-0 cursor-grab items-center justify-center rounded text-slate-300 hover:bg-slate-100 hover:text-slate-500 focus-visible:outline-2 focus-visible:outline-sky-600"
              [attr.aria-label]="'Reorder ' + item.label"
            >
              <span aria-hidden="true" class="text-[10px] leading-none">⠿</span>
            </button>
          }
          <label
            class="flex min-w-0 flex-1 items-center gap-2 rounded py-1 pr-0.5 text-sm text-slate-700"
            [class.pl-1]="!reorderable()"
            [class.bg-sky-50]="isChecked(item.id)"
          >
            <span
              class="min-w-0 flex-1 truncate"
              [style.padding-left.rem]="(item.indent ?? 0) * 0.75"
            >
              {{ item.label }}
            </span>
            <input type="checkbox" [checked]="isChecked(item.id)" (change)="toggle(item.id)" />
          </label>
        </div>
      } @empty {
        <p class="list-empty">None</p>
      }
    </div>

    <p class="list-heading mt-2">Hidden</p>
    @for (item of hidden(); track item.id) {
      <label
        class="flex min-w-0 items-center gap-2 rounded py-1 pl-1 pr-0.5 text-sm text-slate-500"
        [class.bg-sky-50]="isChecked(item.id)"
      >
        <span class="min-w-0 flex-1 truncate" [style.padding-left.rem]="(item.indent ?? 0) * 0.75">
          {{ item.label }}
        </span>
        <input type="checkbox" [checked]="isChecked(item.id)" (change)="toggle(item.id)" />
      </label>
    } @empty {
      <p class="list-empty">None</p>
    }

    @if (checkedVisible().length > 0 || checkedHidden().length > 0) {
      <div class="mt-2 flex flex-wrap gap-1">
        @if (checkedVisible().length > 0) {
          <button type="button" class="list-action" [disabled]="hideBlocked()" (click)="emitHide()">
            Hide selected
          </button>
        }
        @if (checkedHidden().length > 0) {
          <button type="button" class="list-action" (click)="emitShow()">Show selected</button>
        }
        <button type="button" class="list-action" (click)="clear()">Cancel</button>
      </div>
      @if (hideBlocked()) {
        <p class="mt-1 text-[11px] text-slate-400">At least one item stays visible.</p>
      }
    }
  `,
  styles: `
    .list-heading {
      margin-bottom: 0.25rem;
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-slate-400);
    }
    .list-empty {
      padding-left: 0.25rem;
      font-size: 0.75rem;
      color: var(--color-slate-400);
    }
    .list-action {
      border-radius: 0.375rem;
      border: 1px solid var(--color-slate-300);
      background: white;
      padding: 0.125rem 0.5rem;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--color-slate-600);
    }
    .list-action:hover:not(:disabled) {
      background: var(--color-slate-50);
    }
    .list-action:disabled {
      opacity: 0.4;
    }
    .list-action:focus-visible {
      outline: 2px solid var(--color-sky-600);
      outline-offset: 1px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisibilityListComponent {
  readonly visible = input.required<VisibilityItem[]>();
  readonly hidden = input.required<VisibilityItem[]>();
  readonly reorderable = input(false);
  /** Blocks Hide when the selection covers every visible item. */
  readonly keepOneVisible = input(true);

  readonly reordered = output<{ id: string; fromIndex: number; toIndex: number }>();
  readonly hideItems = output<string[]>();
  readonly showItems = output<string[]>();

  protected readonly checked = signal<ReadonlySet<string>>(new Set());

  protected readonly checkedVisible = computed(() =>
    this.visible()
      .filter((item) => this.checked().has(item.id))
      .map((item) => item.id),
  );
  protected readonly checkedHidden = computed(() =>
    this.hidden()
      .filter((item) => this.checked().has(item.id))
      .map((item) => item.id),
  );
  protected readonly hideBlocked = computed(
    () => this.keepOneVisible() && this.checkedVisible().length >= this.visible().length,
  );

  protected isChecked(id: string): boolean {
    return this.checked().has(id);
  }

  protected toggle(id: string): void {
    this.checked.update((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  protected clear(): void {
    this.checked.set(new Set());
  }

  protected emitHide(): void {
    this.hideItems.emit(this.checkedVisible());
    this.clear();
  }

  protected emitShow(): void {
    this.showItems.emit(this.checkedHidden());
    this.clear();
  }

  protected onDrop(event: CdkDragDrop<unknown>): void {
    const id = event.item.data;
    if (typeof id === 'string' && event.previousIndex !== event.currentIndex) {
      this.reordered.emit({ id, fromIndex: event.previousIndex, toIndex: event.currentIndex });
    }
  }
}
