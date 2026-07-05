import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TopicEvaluation } from '../../core/engine/formula-evaluator';
import { TopicCardV2, clampCardHeight, clampCardWidth } from '../../core/model/document.model';
import { DocumentStoreService } from '../../core/store/document-store.service';
import { LatticeComponent } from './lattice/lattice.component';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;

/**
 * Card chrome around one Topic's lattice. Edge-to-edge (no padding), a ⋯
 * menu at the top right, and gesture zoom: Ctrl+wheel — which is also what
 * trackpad pinch delivers — zooms just this card. Zoom is ephemeral view
 * state applied via CSS `zoom`, so tree, table and connectors scale as one
 * surface (ADR-0001); the lattice measures in layout coordinates, so zoom
 * cannot skew alignment or overlays. Card properties are edited by selecting
 * the card (click its root pill or blank area) and using the Details panel.
 */
@Component({
  selector: 'app-topic-card',
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger, LatticeComponent],
  template: `
    <article
      #cardRoot
      class="relative flex h-full min-w-64 shrink-0 flex-col"
      [style.width.px]="fixedSize() ? cardWidth() : null"
      [style.height.px]="fixedSize() ? cardHeight() : null"
      [style.min-width.px]="fixedSize() ? null : cardWidth()"
      [style.min-height.px]="fixedSize() ? null : cardHeight()"
      (click)="onCardClick($event)"
      (wheel)="onWheel($event)"
    >
      <!-- Chrome strip: borderless bar above the content shell holding the
           card title and the ⋯ menu; the drag grip sits just outside, left. -->
      <div class="flex h-7 shrink-0 items-center pl-2 pr-8">
        @if (editingTitle()) {
          <input
            #titleInput
            class="min-w-16 field-sizing-content bg-transparent text-xs font-semibold text-slate-600 focus-visible:outline-none"
            [value]="cardTitle()"
            aria-label="Rename card title"
            (blur)="commitCardTitle($event)"
            (keydown.enter)="commitCardTitleAndBlur($event)"
            (keydown.escape)="cancelTitleEdit($event)"
            (contextmenu)="$event.stopPropagation()"
          />
        } @else {
          <button
            type="button"
            class="max-w-full truncate text-xs font-semibold text-slate-600 focus-visible:outline-2 focus-visible:outline-sky-600"
            [attr.aria-label]="
              'Card ' + cardTitle() + (cardSelected() ? ' (selected — click again to rename)' : '')
            "
            (click)="onTitleClick()"
          >
            {{ cardTitle() }}
          </button>
        }
      </div>
      <button
        type="button"
        class="absolute right-1 top-1 z-30 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-sky-600"
        [cdkMenuTriggerFor]="cardMenu"
        [attr.aria-label]="'Actions for topic ' + topic().displayName"
      >
        <span aria-hidden="true">⋯</span>
      </button>

      <!-- Content shell: the bordered card body; the focus bar spans exactly this. -->
      <div class="relative flex min-h-0 flex-1 flex-col border border-slate-200 bg-white shadow-sm">
        @if (isCardFocused()) {
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-y-0 left-0 z-30 w-1 bg-sky-400"
          ></div>
        }

        <div class="flex-1 overflow-auto">
          <div #zoomSurface [style.zoom]="zoom()">
            <app-lattice
              [topic]="topic()"
              [evaluation]="evaluation()"
              (requestDeleteTopic)="requestDeleteTopic.emit($event)"
              (requestDeleteNode)="requestDeleteNode.emit($event)"
              (notify)="notify.emit($event)"
            />
          </div>
        </div>

        <!-- Resize handles: dragging a border fixes that dimension (persisted
             on the card); double-click releases it back to following content. -->
        <button
          type="button"
          class="absolute inset-y-0 right-0 z-30 w-1.5 cursor-col-resize touch-none hover:bg-sky-200/70 focus-visible:bg-sky-300/70 focus-visible:outline-none"
          aria-label="Resize card width (drag, or arrow keys; double-click releases)"
          (pointerdown)="startResize($event, 'right')"
          (keydown.arrowleft)="nudgeWidth($event, -32)"
          (keydown.arrowright)="nudgeWidth($event, 32)"
          (dblclick)="store.setCardSize(topic().id, { width: null })"
        ></button>
        <button
          type="button"
          class="absolute inset-y-0 left-0 z-30 w-1.5 cursor-col-resize touch-none hover:bg-sky-200/70 focus-visible:bg-sky-300/70 focus-visible:outline-none"
          aria-label="Resize card width from the left edge (drag, or arrow keys; double-click releases)"
          (pointerdown)="startResize($event, 'left')"
          (keydown.arrowleft)="nudgeWidth($event, -32)"
          (keydown.arrowright)="nudgeWidth($event, 32)"
          (dblclick)="store.setCardSize(topic().id, { width: null })"
        ></button>
        <button
          type="button"
          class="absolute inset-x-0 bottom-0 z-30 h-1.5 cursor-row-resize touch-none hover:bg-sky-200/70 focus-visible:bg-sky-300/70 focus-visible:outline-none"
          aria-label="Resize card height (drag, or arrow keys; double-click releases)"
          (pointerdown)="startResize($event, 'bottom')"
          (keydown.arrowup)="nudgeHeight($event, -32)"
          (keydown.arrowdown)="nudgeHeight($event, 32)"
          (dblclick)="store.setCardSize(topic().id, { height: null })"
        ></button>
        <button
          type="button"
          class="absolute inset-x-0 top-0 z-30 h-1.5 cursor-row-resize touch-none hover:bg-sky-200/70 focus-visible:bg-sky-300/70 focus-visible:outline-none"
          aria-label="Resize card height from the top edge (drag, or arrow keys; double-click releases)"
          (pointerdown)="startResize($event, 'top')"
          (keydown.arrowup)="nudgeHeight($event, -32)"
          (keydown.arrowdown)="nudgeHeight($event, 32)"
          (dblclick)="store.setCardSize(topic().id, { height: null })"
        ></button>
      </div>
    </article>

    <ng-template #cardMenu>
      <div
        cdkMenu
        class="z-50 w-52 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-700 shadow-xl"
      >
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="store.addChildNode(topic().id, null)"
        >
          Add node
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="store.addChartCard(topic().id)"
        >
          Create chart of this table
        </button>
        <button cdkMenuItem type="button" class="menu-item" (cdkMenuItemTriggered)="fitToCard()">
          Fit to width
        </button>
        <button cdkMenuItem type="button" class="menu-item" (cdkMenuItemTriggered)="zoom.set(1)">
          Reset zoom ({{ zoomPercent() }})
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item text-rose-700"
          (cdkMenuItemTriggered)="requestDeleteTopic.emit(topic().id)"
        >
          Delete topic
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
export class TopicCardComponent {
  protected readonly store = inject(DocumentStoreService);

  readonly topic = input.required<TopicCardV2>();
  readonly evaluation = input.required<TopicEvaluation>();

  readonly requestDeleteTopic = output<string>();
  readonly requestDeleteNode = output<{ topicId: string; nodeId: string }>();
  readonly notify = output<string>();

  protected readonly zoom = signal(1);
  protected readonly zoomPercent = computed(() => `${Math.round(this.zoom() * 100)}%`);

  /** Live override while a border drag is in flight; persisted on release. */
  private readonly dragWidth = signal<number | null>(null);
  private readonly dragHeight = signal<number | null>(null);

  protected readonly cardWidth = computed(
    () => this.dragWidth() ?? this.topic().sizing?.width ?? null,
  );
  protected readonly cardHeight = computed(
    () => this.dragHeight() ?? this.topic().sizing?.height ?? null,
  );
  /** Auto-expand off: the size is exact and overflow scrolls inside. */
  protected readonly fixedSize = computed(() => this.topic().sizing?.fixed === true);
  protected readonly editingTitle = signal(false);
  protected readonly cardTitle = computed(() => this.topic().cardTitle ?? this.topic().displayName);
  protected readonly cardSelected = computed(() => {
    const selection = this.store.selection();
    return selection?.kind === 'card' && selection.topicId === this.topic().id;
  });
  /** Focused = the current selection (of any kind) lives in this card. */
  protected readonly isCardFocused = computed(
    () => this.store.selection()?.topicId === this.topic().id,
  );

  private readonly cardRootRef = viewChild.required<ElementRef<HTMLElement>>('cardRoot');
  private readonly zoomSurfaceRef = viewChild.required<ElementRef<HTMLElement>>('zoomSurface');
  private readonly titleInputRef = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  constructor() {
    afterRenderEffect(() => {
      if (this.editingTitle()) {
        const input = this.titleInputRef()?.nativeElement;
        input?.focus();
        input?.select();
      }
    });
  }

  /** Selection-first for the title: click selects the card, click again renames. */
  protected onTitleClick(): void {
    if (this.cardSelected()) {
      this.editingTitle.set(true);
    } else {
      this.store.select({ kind: 'card', topicId: this.topic().id });
    }
  }

  protected commitCardTitle(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.editingTitle.set(false);
    this.store.setCardTitle(this.topic().id, value);
  }

  protected commitCardTitleAndBlur(event: Event): void {
    event.preventDefault();
    this.commitCardTitle(event);
    (event.target as HTMLInputElement | null)?.blur();
  }

  protected cancelTitleEdit(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.editingTitle.set(false);
  }

  /**
   * Clicking anywhere non-interactive in the card selects the card. Every
   * interactive element here is a native control or carries a tabindex, so
   * their clicks (which manage selection themselves) are left alone.
   */
  protected onCardClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && !target.closest('button, input, select, textarea, a, [tabindex]')) {
      this.store.select({ kind: 'card', topicId: this.topic().id });
    }
  }

  /** Ctrl+wheel (or trackpad pinch, which browsers deliver the same way) zooms this card only. */
  protected onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom() * factor));
    this.zoom.set(Math.round(next * 100) / 100);
  }

  /** Dragging any border resizes just this card; content scrolls inside. */
  protected startResize(event: PointerEvent, edge: 'left' | 'right' | 'top' | 'bottom'): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released.
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = this.cardRootRef().nativeElement.offsetWidth;
    const startHeight = this.cardRootRef().nativeElement.offsetHeight;
    const horizontal = edge === 'left' || edge === 'right';
    const sign = edge === 'right' || edge === 'bottom' ? 1 : -1;

    const onMove = (moveEvent: PointerEvent): void => {
      if (horizontal) {
        this.dragWidth.set(clampCardWidth(startWidth + sign * (moveEvent.clientX - startX)));
      } else {
        this.dragHeight.set(clampCardHeight(startHeight + sign * (moveEvent.clientY - startY)));
      }
    };
    const cleanup = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
    };
    const onUp = (): void => {
      cleanup();
      // Persist once per gesture — one undo step.
      const width = this.dragWidth();
      const height = this.dragHeight();
      this.store.setCardSize(this.topic().id, {
        ...(width !== null ? { width } : {}),
        ...(height !== null ? { height } : {}),
      });
      this.dragWidth.set(null);
      this.dragHeight.set(null);
    };
    const onCancel = (): void => {
      cleanup();
      this.dragWidth.set(null);
      this.dragHeight.set(null);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  }

  protected nudgeWidth(event: Event, delta: number): void {
    event.preventDefault();
    const current = this.cardWidth() ?? this.cardRootRef().nativeElement.offsetWidth;
    this.store.setCardSize(this.topic().id, { width: current + delta });
  }

  protected nudgeHeight(event: Event, delta: number): void {
    event.preventDefault();
    const current = this.cardHeight() ?? this.cardRootRef().nativeElement.offsetHeight;
    this.store.setCardSize(this.topic().id, { height: current + delta });
  }

  /** Zooms the lattice (shrink or enlarge) to fill the card's visible width. */
  protected fitToCard(): void {
    const surface = this.zoomSurfaceRef().nativeElement;
    const viewport = surface.parentElement;
    // app-lattice is an inline host (offsetWidth 0); measure its block root.
    const content = surface.querySelector<HTMLElement>('app-lattice > div');
    if (!viewport || !content || content.offsetWidth === 0) {
      return;
    }
    // offsetWidth is in layout units (unaffected by the surface's CSS zoom),
    // clientWidth is outside the zoom — their ratio IS the fitting zoom.
    const fit = viewport.clientWidth / content.offsetWidth;
    this.zoom.set(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.floor(fit * 100) / 100)));
  }
}
