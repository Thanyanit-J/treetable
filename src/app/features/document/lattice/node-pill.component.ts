import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { AccentColor } from '../../../core/model/document.model';
import { PillKind } from '../../../core/lattice/lattice-layout';

const PILL_SHELL_BY_ACCENT: Record<AccentColor, string> = {
  sky: 'border-sky-300 bg-sky-100',
  amber: 'border-amber-300 bg-amber-100',
  emerald: 'border-emerald-300 bg-emerald-100',
  rose: 'border-rose-300 bg-rose-100',
  violet: 'border-violet-300 bg-violet-100',
  slate: 'border-slate-300 bg-slate-200',
};

/**
 * A Node rendered as a pill — the merged-cell of the lattice (ADR-0001).
 * One click selects (Inspector shows details); a second click edits the
 * label; holding and dragging the label (or the grip) moves the Node
 * (CONTEXT.md). Everything else lives in the Inspector, so the menu stays
 * to Duplicate and Delete.
 */
@Component({
  selector: 'app-node-pill',
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger, CdkContextMenuTrigger],
  template: `
    <div
      class="group relative z-10 inline-flex w-fit items-center border shadow-sm"
      [class]="shellClass()"
      [class.ring-2]="dropTarget() || selected()"
      [class.ring-emerald-500]="dropTarget()"
      [class.ring-sky-500]="!dropTarget() && selected()"
      [cdkContextMenuTriggerFor]="actionsMenu"
      [attr.data-pill-id]="pillId()"
    >
      <!-- Chrome buttons overlay the label (absolute) and appear on hover, so
           the text stays centered and the pill never resizes. -->
      @if (kind() !== 'root') {
        <button
          type="button"
          class="pointer-events-none absolute left-0.5 top-1/2 z-10 flex h-5 w-4 shrink-0 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded bg-white/70 text-slate-400 opacity-0 transition-opacity hover:bg-white focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-600 group-hover:pointer-events-auto group-hover:opacity-100"
          [attr.aria-label]="'Drag ' + label() + ' (or use Move up / Move down in the Inspector)'"
          (pointerdown)="dragStarted.emit($event)"
        >
          <span aria-hidden="true" class="text-[10px] leading-none">⠿</span>
        </button>
      }
      @if (kind() === 'collapsed') {
        <span aria-hidden="true" class="ml-1.5 text-[10px] leading-none text-slate-500">▸</span>
      }

      @if (editing()) {
        <input
          #labelInput
          class="min-w-16 field-sizing-content bg-transparent px-2 py-1.5 text-center text-sm focus-visible:outline-none"
          [class.font-semibold]="kind() === 'root'"
          [class.font-medium]="kind() !== 'root'"
          [value]="label()"
          [attr.aria-label]="ariaLabel()"
          (blur)="commit($event)"
          (keydown.enter)="commitAndBlur($event)"
          (keydown.escape)="cancelEdit($event)"
          (contextmenu)="$event.stopPropagation()"
        />
      } @else {
        <button
          type="button"
          class="min-w-16 cursor-default truncate px-2 py-1.5 text-center text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
          [class.touch-none]="kind() !== 'root'"
          [class.font-semibold]="kind() === 'root'"
          [class.font-medium]="kind() !== 'root'"
          [attr.aria-label]="
            ariaLabel() + (selected() ? ' (selected — click again to rename)' : '')
          "
          (pointerdown)="onLabelPointerDown($event)"
          (click)="onLabelKeyboardClick($event)"
          (keydown.enter)="beginEditIfSelected($event)"
          (focus)="selectedChange.emit()"
        >
          {{ label() }}
        </button>
      }

      <button
        type="button"
        class="pointer-events-none absolute right-0.5 top-1/2 z-10 flex h-5 w-5 shrink-0 -translate-y-1/2 items-center justify-center rounded-full bg-white/70 text-slate-500 opacity-0 transition-opacity hover:bg-white focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-600 group-hover:pointer-events-auto group-hover:opacity-100"
        [cdkMenuTriggerFor]="actionsMenu"
        [attr.aria-label]="'Actions for ' + label()"
      >
        <span aria-hidden="true" class="text-xs leading-none">⋯</span>
      </button>
    </div>

    <ng-template #actionsMenu>
      <div
        cdkMenu
        class="z-50 w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-700 shadow-xl"
      >
        @if (kind() === 'branch' || kind() === 'collapsed') {
          <button
            cdkMenuItem
            type="button"
            class="menu-item"
            (cdkMenuItemTriggered)="toggleCollapse.emit()"
          >
            {{ kind() === 'collapsed' ? 'Expand' : 'Collapse' }}
          </button>
        }
        @if (kind() === 'root') {
          <button
            cdkMenuItem
            type="button"
            class="menu-item"
            (cdkMenuItemTriggered)="addChild.emit()"
          >
            Add child node
          </button>
        } @else {
          <button
            cdkMenuItem
            type="button"
            class="menu-item"
            (cdkMenuItemTriggered)="duplicate.emit()"
          >
            Duplicate
          </button>
        }
        <button
          cdkMenuItem
          type="button"
          class="menu-item text-rose-700"
          (cdkMenuItemTriggered)="remove.emit()"
        >
          {{ kind() === 'root' ? 'Delete topic' : 'Delete node' }}
        </button>
      </div>
    </ng-template>
  `,
  styles: `
    .menu-item {
      display: block;
      width: 100%;
      border-radius: 0.375rem;
      padding: 0.5rem 0.75rem;
      text-align: left;
    }
    .menu-item:hover:not(:disabled),
    .menu-item:focus-visible {
      background: var(--color-slate-100);
      outline: none;
    }
    .menu-item:disabled {
      opacity: 0.4;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodePillComponent {
  readonly pillId = input.required<string>();
  readonly label = input.required<string>();
  readonly kind = input.required<PillKind>();
  readonly accent = input<AccentColor | null>(null);
  readonly selected = input(false);
  readonly dropTarget = input(false);

  readonly renamed = output<string>();
  readonly selectedChange = output<void>();
  readonly toggleCollapse = output<void>();
  readonly addChild = output<void>();
  readonly remove = output<void>();
  readonly dragStarted = output<PointerEvent>();
  readonly duplicate = output<void>();

  protected readonly editing = signal(false);
  private readonly labelInputRef = viewChild<ElementRef<HTMLInputElement>>('labelInput');

  constructor() {
    afterRenderEffect(() => {
      if (this.editing()) {
        const input = this.labelInputRef()?.nativeElement;
        input?.focus();
        input?.select();
      }
    });
  }

  protected readonly shellClass = computed(() => {
    const parts: string[] = [];
    parts.push(this.kind() === 'root' ? 'rounded-full' : 'rounded-xl');
    const accent = this.accent();
    if (accent) {
      parts.push(PILL_SHELL_BY_ACCENT[accent]);
    } else {
      parts.push(this.kind() === 'root' ? PILL_SHELL_BY_ACCENT.sky : PILL_SHELL_BY_ACCENT.amber);
    }
    return parts.join(' ');
  });

  protected readonly ariaLabel = computed(() => {
    const noun = this.kind() === 'root' ? 'Topic' : 'Node';
    return `${noun}: ${this.label()}`;
  });

  /**
   * Selection-first on the label itself: the pill's selected state is read
   * at pointerDOWN (before focus/selection side effects), so the first click
   * only selects and only a second click starts renaming. Holding and moving
   * past a small threshold hands the gesture to the lattice as a drag.
   */
  protected onLabelPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    // Suppress pointer-driven focus: selection stays a deliberate outcome.
    event.preventDefault();
    const label = event.currentTarget as HTMLElement;
    const wasSelected = this.selected();
    const draggable = this.kind() !== 'root';
    const startX = event.clientX;
    const startY = event.clientY;

    try {
      label.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already gone (e.g. synthetic events in tests).
    }

    const cleanup = (): void => {
      label.removeEventListener('pointermove', onMove);
      label.removeEventListener('pointerup', onUp);
      label.removeEventListener('pointercancel', cleanup);
    };
    const onMove = (moveEvent: PointerEvent): void => {
      if (!draggable || Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) {
        return;
      }
      cleanup();
      // The lattice re-captures the pointer and runs the drag session.
      this.dragStarted.emit(event);
    };
    const onUp = (): void => {
      cleanup();
      if (wasSelected) {
        this.editing.set(true);
      } else {
        this.selectedChange.emit();
        label.focus({ preventScroll: true });
      }
    };
    label.addEventListener('pointermove', onMove);
    label.addEventListener('pointerup', onUp);
    label.addEventListener('pointercancel', cleanup);
  }

  /** Keyboard activation (Space) arrives as a click with `detail === 0`. */
  protected onLabelKeyboardClick(event: MouseEvent): void {
    if (event.detail === 0) {
      this.beginEditIfSelected(event);
    }
  }

  protected beginEditIfSelected(event: Event): void {
    event.preventDefault();
    this.editing.set(true);
  }

  protected commit(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.editing.set(false);
    if (value.trim().length > 0 && value !== this.label()) {
      this.renamed.emit(value);
    }
  }

  protected commitAndBlur(event: Event): void {
    event.preventDefault();
    this.commit(event);
  }

  protected cancelEdit(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.editing.set(false);
  }
}
