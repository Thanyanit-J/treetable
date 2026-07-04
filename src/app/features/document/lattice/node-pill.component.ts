import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { ACCENT_COLORS, AccentColor } from '../../../core/model/document.model';
import { PillKind } from './lattice-layout';

const PILL_SHELL_BY_ACCENT: Record<AccentColor, string> = {
  sky: 'border-sky-300 bg-sky-100',
  amber: 'border-amber-300 bg-amber-100',
  emerald: 'border-emerald-300 bg-emerald-100',
  rose: 'border-rose-300 bg-rose-100',
  violet: 'border-violet-300 bg-violet-100',
  slate: 'border-slate-300 bg-slate-200',
};

const SWATCH_BY_ACCENT: Record<AccentColor, string> = {
  sky: 'bg-sky-400',
  amber: 'bg-amber-400',
  emerald: 'bg-emerald-400',
  rose: 'bg-rose-400',
  violet: 'bg-violet-400',
  slate: 'bg-slate-400',
};

/**
 * A Node rendered as a pill — the merged-cell of the lattice (ADR-0001).
 * Owns label editing, the collapse toggle, and the node action menu
 * (button-triggered and context-menu-triggered alike, so every operation
 * has a keyboard path).
 */
@Component({
  selector: 'app-node-pill',
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger, CdkContextMenuTrigger],
  template: `
    <div
      class="group relative z-10 inline-flex w-fit items-center gap-0.5 border pr-1 shadow-sm"
      [class]="shellClass()"
      [class.ring-2]="dropTarget()"
      [class.ring-emerald-500]="dropTarget()"
      [cdkContextMenuTriggerFor]="actionsMenu"
      [attr.data-pill-id]="pillId()"
    >
      @if (kind() !== 'root') {
        <button
          type="button"
          class="ml-0.5 flex h-5 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-white/70 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-600 group-hover:opacity-100"
          [attr.aria-label]="'Drag ' + label() + ' (or use Move up / Move down in the menu)'"
          (pointerdown)="dragStarted.emit($event)"
        >
          <span aria-hidden="true" class="text-[10px] leading-none">⠿</span>
        </button>
      }
      @if (kind() !== 'leaf') {
        <button
          type="button"
          class="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-sky-600"
          [attr.aria-expanded]="kind() !== 'collapsed'"
          [attr.aria-label]="collapseLabel()"
          (click)="toggleCollapse.emit()"
        >
          <span aria-hidden="true" class="text-[10px] leading-none">{{
            kind() === 'collapsed' ? '▶' : '▼'
          }}</span>
        </button>
      }

      <input
        class="w-auto min-w-16 bg-transparent px-2 py-1.5 text-center text-sm focus-visible:outline-none"
        [class.font-semibold]="kind() === 'root'"
        [class.font-medium]="kind() !== 'root'"
        [value]="draft() ?? label()"
        [attr.size]="inputSize()"
        [attr.aria-label]="ariaLabel()"
        (focus)="onFocus()"
        (input)="onInput($event)"
        (blur)="onBlur()"
        (keydown.enter)="onEnter($event)"
        (keydown.escape)="onEscape($event)"
      />

      <button
        type="button"
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-500 opacity-0 transition-opacity hover:bg-white/70 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-600 group-hover:opacity-100"
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
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="addChild.emit()"
        >
          Add child node
        </button>
        @if (kind() !== 'root') {
          <button
            cdkMenuItem
            type="button"
            class="menu-item"
            (cdkMenuItemTriggered)="addSibling.emit()"
          >
            Add node below
          </button>
          <button
            cdkMenuItem
            type="button"
            class="menu-item"
            [disabled]="!canMoveUp()"
            (cdkMenuItemTriggered)="moveUp.emit()"
          >
            Move up
          </button>
          <button
            cdkMenuItem
            type="button"
            class="menu-item"
            [disabled]="!canMoveDown()"
            (cdkMenuItemTriggered)="moveDown.emit()"
          >
            Move down
          </button>
          <div class="my-1 flex items-center gap-1 px-2 py-1" role="group" aria-label="Node color">
            @for (color of accentColors; track color) {
              <button
                cdkMenuItem
                type="button"
                class="h-5 w-5 rounded-full border border-white shadow ring-slate-400 hover:ring-2"
                [class]="swatchClass(color)"
                [class.ring-2]="accent() === color"
                [attr.aria-label]="'Set color ' + color"
                (cdkMenuItemTriggered)="setAccent.emit(color)"
              ></button>
            }
            <button
              cdkMenuItem
              type="button"
              class="ml-1 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
              (cdkMenuItemTriggered)="setAccent.emit(null)"
            >
              None
            </button>
          </div>
        }
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="editRefName.emit()"
        >
          Edit reference name…
        </button>
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
    .menu-item:hover,
    .menu-item:focus-visible {
      background: var(--color-slate-100);
      outline: none;
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
  readonly canMoveUp = input(false);
  readonly canMoveDown = input(false);

  readonly renamed = output<string>();
  readonly selectedChange = output<void>();
  readonly toggleCollapse = output<void>();
  readonly addChild = output<void>();
  readonly addSibling = output<void>();
  readonly remove = output<void>();
  readonly setAccent = output<AccentColor | null>();
  readonly editRefName = output<void>();
  readonly dragStarted = output<PointerEvent>();
  readonly moveUp = output<void>();
  readonly moveDown = output<void>();

  protected readonly accentColors = ACCENT_COLORS;
  protected readonly draft = signal<string | null>(null);

  protected readonly shellClass = computed(() => {
    const parts: string[] = [];
    parts.push(this.kind() === 'root' ? 'rounded-full' : 'rounded-xl');
    const accent = this.accent();
    if (accent) {
      parts.push(PILL_SHELL_BY_ACCENT[accent]);
    } else {
      parts.push(this.kind() === 'root' ? PILL_SHELL_BY_ACCENT.sky : PILL_SHELL_BY_ACCENT.amber);
    }
    if (this.selected()) {
      parts.push('ring-2 ring-sky-500');
    }
    return parts.join(' ');
  });

  protected readonly ariaLabel = computed(() => {
    const noun = this.kind() === 'root' ? 'Topic' : 'Node';
    return `${noun} label: ${this.label()}`;
  });

  protected readonly collapseLabel = computed(() =>
    this.kind() === 'collapsed' ? `Expand ${this.label()}` : `Collapse ${this.label()}`,
  );

  protected inputSize(): number {
    const text = this.draft() ?? this.label();
    return Math.max(6, Math.min(48, text.length + 2));
  }

  protected swatchClass(color: AccentColor): string {
    return SWATCH_BY_ACCENT[color];
  }

  protected onFocus(): void {
    this.selectedChange.emit();
    if (this.draft() === null) {
      this.draft.set(this.label());
    }
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected onBlur(): void {
    this.commit();
  }

  protected onEnter(event: Event): void {
    event.preventDefault();
    this.commit();
    (event.target as HTMLInputElement | null)?.blur();
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.draft.set(null);
    const input = event.target as HTMLInputElement | null;
    if (input) {
      input.value = this.label();
      input.blur();
    }
  }

  private commit(): void {
    const draft = this.draft();
    this.draft.set(null);
    if (draft !== null && draft.trim().length > 0 && draft !== this.label()) {
      this.renamed.emit(draft);
    }
  }
}
