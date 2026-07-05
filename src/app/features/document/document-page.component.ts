import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DocumentStoreService } from '../../core/store/document-store.service';
import { TopicEvaluation } from '../../core/engine/formula-evaluator';
import { CardV2 } from '../../core/model/document.model';
import { ChartCardComponent } from './chart-card.component';
import { ConfirmDialogComponent } from './ui/confirm-dialog.component';
import { DetailsPanelComponent } from './details-panel.component';
import { FormulaSuggestOverlayComponent } from './formula-suggest-overlay.component';
import { NoteCardComponent } from './note-card.component';
import { PageSidebarComponent } from './page-sidebar.component';
import { TopicCardComponent } from './topic-card.component';

interface PendingDeleteTopic {
  type: 'topic';
  topicId: string;
  displayName: string;
}

interface PendingDeleteNode {
  type: 'node';
  topicId: string;
  nodeId: string;
  canKeepData: boolean;
}

interface PendingDeletePage {
  type: 'page';
  pageId: string;
  name: string;
  cardCount: number;
}

type PendingDelete = PendingDeleteTopic | PendingDeleteNode | PendingDeletePage;

/** One live card-drag gesture; pointer capture stays on the grip throughout. */
interface CardDragSession {
  cardId: string;
  grip: HTMLElement;
  rail: HTMLElement | null;
  pointerId: number;
  startX: number;
  startY: number;
  /** True once the pointer travels past the click threshold. */
  started: boolean;
  zones: { key: string; rect: DOMRect }[];
  preview: HTMLElement | null;
  /** Scroll container around the rail; edges auto-scroll during the drag. */
  scrollHost: HTMLElement | null;
  /** Scroll position when zones were measured; hit-testing compensates. */
  baseScrollLeft: number;
  baseScrollTop: number;
  lastX: number;
  lastY: number;
  rafId: number | null;
  onMove: (event: PointerEvent) => void;
  onUp: () => void;
  onCancel: () => void;
}

interface Toast {
  ok: boolean;
  text: string;
}

/**
 * Document shell: slim toolbar, edge-to-edge card rail, Details panel
 * owning the right edge (toggled from the toolbar). Clipboard shortcuts (Ctrl/Cmd+C/X/V, Delete) act on the current
 * selection whenever focus is not inside a text editor.
 */
@Component({
  selector: 'app-document-page',
  imports: [
    ChartCardComponent,
    ConfirmDialogComponent,
    DetailsPanelComponent,
    FormulaSuggestOverlayComponent,
    NoteCardComponent,
    PageSidebarComponent,
    TopicCardComponent,
  ],
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
  template: `
    <div class="flex h-dvh overflow-hidden bg-slate-50">
      <app-page-sidebar [collapsed]="!pagesOpen()" (requestDeletePage)="queuePageDelete($event)" />

      <div class="flex min-w-0 flex-1 flex-col">
        <header
          class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200 bg-white px-2 py-1"
        >
          <input
            class="min-w-0 flex-1 basis-48 cursor-text rounded border border-transparent bg-transparent px-1.5 py-0.5 text-lg font-semibold tracking-tight text-slate-900 transition hover:border-sky-200 focus:border-sky-300 focus-visible:outline-none"
            [value]="store.title()"
            aria-label="Document title"
            (blur)="commitTitle($event)"
            (keydown.enter)="commitTitleAndBlur($event)"
            (keydown.escape)="revertTitle($event)"
          />
          <div class="flex flex-wrap gap-1">
            <button
              type="button"
              class="toolbar-button"
              [disabled]="!store.canUndo()"
              (click)="store.undo()"
            >
              Undo
            </button>
            <button
              type="button"
              class="toolbar-button"
              [disabled]="!store.canRedo()"
              (click)="store.redo()"
            >
              Redo
            </button>
            <button type="button" class="toolbar-button" (click)="exportJson()">Export</button>
            <label class="toolbar-button cursor-pointer">
              Import
              <input
                class="sr-only"
                type="file"
                accept="application/json"
                (change)="importJson($event)"
              />
            </label>
            <button
              type="button"
              class="toolbar-button"
              [attr.aria-pressed]="pagesOpen()"
              (click)="pagesOpen.set(!pagesOpen())"
            >
              {{ pagesOpen() ? 'Hide pages' : 'Show pages' }}
            </button>
            <button
              type="button"
              class="toolbar-button"
              [attr.aria-pressed]="detailsOpen()"
              (click)="detailsOpen.set(!detailsOpen())"
            >
              {{ detailsOpen() ? 'Hide details' : 'Show details' }}
            </button>
          </div>
        </header>

        <div class="min-w-0 flex-1 overflow-auto" (click)="onBackgroundClick($event)">
          @if (store.activeStacks().length === 0) {
            <section
              class="m-6 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center"
            >
              <p class="text-sm text-slate-600">This page has no cards yet.</p>
              <button
                type="button"
                class="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
                (click)="store.addTopic()"
              >
                Add a topic
              </button>
            </section>
          } @else {
            <!-- Stacks side by side. Dragging a card is a custom pointer
                 session: the origin card becomes a grey box (releasing there —
                 or anywhere outside a drop zone — cancels), a small solid
                 snapshot of the card rides under the pointer, and the gaps
                 reveal themselves as drop zones only while hovered, nudging
                 the neighbours slightly apart to preview the landing spot. -->
            <div #rail class="flex h-full min-h-full items-stretch p-3">
              @for (stack of store.activeStacks(); track stack.id; let stackIndex = $index) {
                <div
                  aria-hidden="true"
                  class="drop-zone zone-rail"
                  [class.zone-on]="hoverZone() === 'rail:' + stackIndex"
                  [attr.data-zone]="'rail:' + stackIndex"
                ></div>
                <div class="flex shrink-0 flex-col">
                  @for (card of stack.cards; track card.id; let cardIndex = $index) {
                    <div
                      aria-hidden="true"
                      class="drop-zone zone-row"
                      [class.zone-row-gap]="cardIndex > 0"
                      [class.zone-on]="hoverZone() === 'stack:' + stack.id + ':' + cardIndex"
                      [attr.data-zone]="'stack:' + stack.id + ':' + cardIndex"
                    ></div>
                    <div
                      class="group/card relative flex min-h-0 flex-1"
                      [attr.data-card-id]="card.id"
                    >
                      <button
                        type="button"
                        class="absolute -left-6 top-1 z-30 flex h-6 w-6 cursor-grab touch-none items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-600 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-600 group-hover/card:opacity-100"
                        [attr.aria-label]="'Drag card ' + cardLabel(card)"
                        (pointerdown)="startCardDrag($event, card.id)"
                      >
                        <span aria-hidden="true">⠿</span>
                      </button>
                      @switch (card.kind) {
                        @case ('topic') {
                          <app-topic-card
                            [topic]="card"
                            [evaluation]="evaluationFor(card.id)"
                            (requestDeleteTopic)="queueTopicDelete($event)"
                            (requestDeleteNode)="queueNodeDelete($event.topicId, $event.nodeId)"
                            (notify)="showToast(false, $event)"
                          />
                        }
                        @case ('note') {
                          <app-note-card [card]="card" (requestDelete)="store.removeCard($event)" />
                        }
                        @case ('chartcard') {
                          <app-chart-card
                            [card]="card"
                            (requestDelete)="store.removeCard($event)"
                          />
                        }
                      }
                      @if (cardDragId() === card.id) {
                        <div
                          aria-hidden="true"
                          class="absolute inset-0 z-40 rounded-lg border border-slate-300 bg-slate-200"
                        ></div>
                      }
                    </div>
                  }
                  <div
                    aria-hidden="true"
                    class="drop-zone zone-row"
                    [class.zone-on]="hoverZone() === 'stack:' + stack.id + ':' + stack.cards.length"
                    [attr.data-zone]="'stack:' + stack.id + ':' + stack.cards.length"
                  ></div>
                </div>
              }
              <div
                aria-hidden="true"
                class="drop-zone zone-rail"
                [class.zone-on]="hoverZone() === 'rail:' + store.activeStacks().length"
                [attr.data-zone]="'rail:' + store.activeStacks().length"
              ></div>
            </div>
          }
        </div>
      </div>

      @if (detailsOpen()) {
        <app-details-panel
          (requestDeleteTopic)="queueTopicDelete($event)"
          (requestDeleteNode)="queueNodeDelete($event.topicId, $event.nodeId)"
          (notify)="showToast(false, $event)"
        />
      }

      @if (toast(); as message) {
        <div
          class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
          aria-live="polite"
        >
          <div
            class="pointer-events-auto rounded-lg px-4 py-2 text-sm font-medium shadow-lg ring-1"
            [class.bg-emerald-50]="message.ok"
            [class.text-emerald-800]="message.ok"
            [class.ring-emerald-200]="message.ok"
            [class.bg-rose-50]="!message.ok"
            [class.text-rose-700]="!message.ok"
            [class.ring-rose-200]="!message.ok"
          >
            {{ message.text }}
          </div>
        </div>
      }
    </div>

    <app-confirm-dialog
      [open]="pendingDelete() !== null"
      [title]="confirmTitle()"
      [message]="confirmMessage()"
      [secondaryLabel]="confirmSecondaryLabel()"
      (confirmed)="confirmDelete()"
      (secondaryConfirmed)="confirmDeleteKeepingData()"
      (cancelled)="pendingDelete.set(null)"
    />

    <app-formula-suggest-overlay />
  `,
  styles: `
    .toolbar-button {
      border-radius: 0.25rem;
      border: 1px solid var(--color-slate-300);
      background: white;
      padding: 0.25rem 0.625rem;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--color-slate-700);
    }
    .toolbar-button:hover:not(:disabled) {
      background: var(--color-slate-50);
    }
    .toolbar-button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    .toolbar-button:focus-visible {
      outline: 2px solid var(--color-sky-600);
      outline-offset: 1px;
    }
    .drop-zone {
      flex-shrink: 0;
      border-radius: 0.5rem;
      transition:
        width 0.16s ease,
        height 0.16s ease,
        background-color 0.16s ease;
    }
    .zone-rail {
      width: 1.5rem;
    }
    .zone-rail.zone-on {
      width: 3.5rem;
    }
    .zone-row {
      height: 0;
    }
    .zone-row-gap {
      height: 0.75rem;
    }
    .zone-row.zone-on {
      height: 2.75rem;
    }
    .zone-on {
      background: var(--color-sky-100);
      outline: 2px dashed var(--color-sky-400);
      outline-offset: -2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentPageComponent {
  protected readonly store = inject(DocumentStoreService);

  protected readonly pendingDelete = signal<PendingDelete | null>(null);
  protected readonly detailsOpen = signal(true);
  protected readonly pagesOpen = signal(true);
  protected readonly toast = signal<Toast | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly railRef = viewChild<ElementRef<HTMLElement>>('rail');
  private cardDragSession: CardDragSession | null = null;
  /** Card currently greyed out at its origin while being dragged. */
  protected readonly cardDragId = signal<string | null>(null);
  /** Zone key under the pointer; only this zone expands and lights up. */
  protected readonly hoverZone = signal<string | null>(null);

  private readonly emptyEvaluation: TopicEvaluation = { computedCells: new Map() };
  protected readonly evaluations = computed(() => this.store.evaluations());

  protected evaluationFor(cardId: string): TopicEvaluation {
    return this.evaluations().get(cardId) ?? this.emptyEvaluation;
  }

  protected cardLabel(card: CardV2): string {
    switch (card.kind) {
      case 'topic':
        return card.cardTitle ?? card.displayName;
      case 'note':
        return 'note';
      case 'chartcard':
        return 'charts';
    }
  }

  // ---------------------------------------------------------------------------
  // Card dragging
  // ---------------------------------------------------------------------------

  protected startCardDrag(event: PointerEvent, cardId: string): void {
    if (event.button !== 0 || this.cardDragSession !== null) {
      return;
    }
    event.preventDefault();
    const grip = event.currentTarget as HTMLElement;
    const session: CardDragSession = {
      cardId,
      grip,
      rail: null,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      zones: [],
      preview: null,
      scrollHost: null,
      baseScrollLeft: 0,
      baseScrollTop: 0,
      lastX: event.clientX,
      lastY: event.clientY,
      rafId: null,
      onMove: (moveEvent) => this.onCardDragMove(moveEvent),
      onUp: () => this.finishCardDrag(true),
      onCancel: () => this.finishCardDrag(false),
    };
    this.cardDragSession = session;
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already gone (synthetic events in tests).
    }
    grip.addEventListener('pointermove', session.onMove);
    grip.addEventListener('pointerup', session.onUp);
    grip.addEventListener('pointercancel', session.onCancel);
  }

  private onCardDragMove(event: PointerEvent): void {
    const session = this.cardDragSession;
    if (!session) {
      return;
    }
    session.lastX = event.clientX;
    session.lastY = event.clientY;
    if (!session.started) {
      if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 5) {
        return;
      }
      this.activateCardDrag(session, event);
      if (!session.started) {
        return;
      }
    }
    session.preview?.style.setProperty(
      'transform',
      `translate(${event.clientX + 14}px, ${event.clientY + 10}px)`,
    );
    this.hoverZone.set(this.zoneAt(session, event.clientX, event.clientY));
  }

  /** Past the click threshold: snapshot geometry, grey the origin, spawn the preview. */
  private activateCardDrag(session: CardDragSession, event: PointerEvent): void {
    const cardElement = session.grip.closest<HTMLElement>('[data-card-id]');
    const rail = this.railRef()?.nativeElement ?? null;
    if (!cardElement || !rail) {
      return;
    }
    session.started = true;
    session.rail = rail;
    // Zone rects are measured once, before any zone expands: hover-expansion
    // shifts the layout by ~2rem — far less than a card — so the static rects
    // stay aim-true, and hit-testing cannot feed back into its own layout.
    const disabled = this.noopZones(session.cardId);
    session.zones = Array.from(rail.querySelectorAll<HTMLElement>('[data-zone]'))
      .map((zone) => ({ key: zone.dataset['zone'] ?? '', rect: zone.getBoundingClientRect() }))
      .filter((zone) => zone.key !== '' && !disabled.has(zone.key));
    session.preview = this.buildDragPreview(cardElement, event);
    session.scrollHost = rail.parentElement;
    session.baseScrollLeft = session.scrollHost?.scrollLeft ?? 0;
    session.baseScrollTop = session.scrollHost?.scrollTop ?? 0;
    const step = (): void => {
      if (this.cardDragSession !== session) {
        return;
      }
      this.autoScrollRail(session);
      session.rafId = requestAnimationFrame(step);
    };
    session.rafId = requestAnimationFrame(step);
    document.body.classList.add('tt-card-dragging');
    this.cardDragId.set(session.cardId);
  }

  /**
   * Holding the pointer near a rail edge scrolls the rail, so drop positions
   * beyond the viewport stay reachable in both directions.
   */
  private autoScrollRail(session: CardDragSession): void {
    const host = session.scrollHost;
    if (!host) {
      return;
    }
    const edge = 48;
    const maxStep = 16;
    const rect = host.getBoundingClientRect();
    const pull = (distance: number): number =>
      Math.ceil((Math.min(distance, edge) / edge) * maxStep);
    let dx = 0;
    let dy = 0;
    if (session.lastX < rect.left + edge) {
      dx = -pull(rect.left + edge - session.lastX);
    } else if (session.lastX > rect.right - edge) {
      dx = pull(session.lastX - (rect.right - edge));
    }
    if (session.lastY < rect.top + edge) {
      dy = -pull(rect.top + edge - session.lastY);
    } else if (session.lastY > rect.bottom - edge) {
      dy = pull(session.lastY - (rect.bottom - edge));
    }
    if (dx === 0 && dy === 0) {
      return;
    }
    const beforeLeft = host.scrollLeft;
    const beforeTop = host.scrollTop;
    host.scrollLeft += dx;
    host.scrollTop += dy;
    if (host.scrollLeft !== beforeLeft || host.scrollTop !== beforeTop) {
      this.hoverZone.set(this.zoneAt(session, session.lastX, session.lastY));
    }
  }

  private finishCardDrag(commit: boolean): void {
    const session = this.cardDragSession;
    if (!session) {
      return;
    }
    this.cardDragSession = null;
    if (session.rafId !== null) {
      cancelAnimationFrame(session.rafId);
    }
    session.grip.removeEventListener('pointermove', session.onMove);
    session.grip.removeEventListener('pointerup', session.onUp);
    session.grip.removeEventListener('pointercancel', session.onCancel);
    try {
      session.grip.releasePointerCapture(session.pointerId);
    } catch {
      // Capture already released.
    }
    session.preview?.remove();
    document.body.classList.remove('tt-card-dragging');
    const target = this.hoverZone();
    this.hoverZone.set(null);
    this.cardDragId.set(null);
    if (commit && session.started && target !== null) {
      this.dropCard(session.cardId, target);
    }
  }

  /** Maps a zone key onto the store's move APIs (both no-op on same position). */
  private dropCard(cardId: string, zoneKey: string): void {
    if (zoneKey.startsWith('rail:')) {
      this.store.moveCardToNewStack(cardId, this.store.activePage().id, Number(zoneKey.slice(5)));
      return;
    }
    const rest = zoneKey.slice('stack:'.length);
    const separator = rest.lastIndexOf(':');
    const stackId = rest.slice(0, separator);
    let index = Number(rest.slice(separator + 1));
    const origin = this.store
      .activeStacks()
      .find((stack) => stack.cards.some((card) => card.id === cardId));
    if (origin && origin.id === stackId) {
      const from = origin.cards.findIndex((card) => card.id === cardId);
      if (index > from) {
        index -= 1; // moveCardToStack expects the post-removal index.
      }
    }
    this.store.moveCardToStack(cardId, stackId, index);
  }

  /** Zones where dropping would change nothing; they never light up. */
  private noopZones(cardId: string): Set<string> {
    const zones = new Set<string>();
    const stacks = this.store.activeStacks();
    const stackIndex = stacks.findIndex((stack) => stack.cards.some((card) => card.id === cardId));
    const stack = stacks[stackIndex];
    if (!stack) {
      return zones;
    }
    const cardIndex = stack.cards.findIndex((card) => card.id === cardId);
    zones.add(`stack:${stack.id}:${cardIndex}`);
    zones.add(`stack:${stack.id}:${cardIndex + 1}`);
    if (stack.cards.length === 1) {
      zones.add(`rail:${stackIndex}`);
      zones.add(`rail:${stackIndex + 1}`);
    }
    return zones;
  }

  private zoneAt(session: CardDragSession, x: number, y: number): string | null {
    // Hysteresis: the hovered zone is re-measured live (it is expanded), so
    // the pointer must actually leave it before another zone can win.
    const current = this.hoverZone();
    if (current !== null && session.rail) {
      const element = session.rail.querySelector(`[data-zone="${current}"]`);
      if (element && this.zoneHit(current, element.getBoundingClientRect(), x, y)) {
        return current;
      }
    }
    // Static rects were measured at the activation scroll position; testing
    // the pointer in that frame keeps them truthful after auto-scrolling.
    const staticX = x + (session.scrollHost?.scrollLeft ?? 0) - session.baseScrollLeft;
    const staticY = y + (session.scrollHost?.scrollTop ?? 0) - session.baseScrollTop;
    let bestKey: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const zone of session.zones) {
      if (!this.zoneHit(zone.key, zone.rect, staticX, staticY)) {
        continue;
      }
      const centerX = (zone.rect.left + zone.rect.right) / 2;
      const centerY = (zone.rect.top + zone.rect.bottom) / 2;
      // Rail zones span the full rail height; only horizontal aim matters.
      const distance = zone.key.startsWith('rail:')
        ? Math.abs(staticX - centerX)
        : Math.hypot(staticX - centerX, staticY - centerY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestKey = zone.key;
      }
    }
    return bestKey;
  }

  /** Zones accept the pointer well beyond their painted bounds. */
  private zoneHit(key: string, rect: DOMRect, x: number, y: number): boolean {
    const isRail = key.startsWith('rail:');
    const marginX = isRail ? 20 : 8;
    const marginY = isRail ? 0 : 18;
    return (
      x >= rect.left - marginX &&
      x <= rect.right + marginX &&
      y >= rect.top - marginY &&
      y <= rect.bottom + marginY
    );
  }

  /** A solid mini snapshot of the card that rides along under the pointer. */
  private buildDragPreview(cardElement: HTMLElement, event: PointerEvent): HTMLElement {
    const rect = cardElement.getBoundingClientRect();
    const scale = Math.min(0.4, 260 / Math.max(rect.width, 1));
    const clone = cardElement.cloneNode(true) as HTMLElement;
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.transform = `scale(${scale})`;
    clone.style.transformOrigin = 'top left';
    const shell = document.createElement('div');
    shell.setAttribute('aria-hidden', 'true');
    shell.className = 'tt-card-drag-preview';
    shell.style.width = `${Math.round(rect.width * scale)}px`;
    shell.style.height = `${Math.round(Math.min(rect.height * scale, 320))}px`;
    shell.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 10}px)`;
    shell.append(clone);
    document.body.append(shell);
    return shell;
  }

  /** Clicking the empty background clears the selection. */
  protected onBackgroundClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.store.select(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------------

  protected commitTitle(event: Event): void {
    this.store.setTitle((event.target as HTMLInputElement).value);
  }

  protected commitTitleAndBlur(event: Event): void {
    event.preventDefault();
    this.commitTitle(event);
    (event.target as HTMLInputElement | null)?.blur();
  }

  protected revertTitle(event: Event): void {
    event.preventDefault();
    const input = event.target as HTMLInputElement | null;
    if (input) {
      input.value = this.store.title();
      input.blur();
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.cardDragSession !== null) {
      event.preventDefault();
      this.finishCardDrag(false);
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      return;
    }

    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (modifier && key === 'z' && event.shiftKey) {
      event.preventDefault();
      this.store.redo();
      return;
    }
    if (modifier && key === 'z') {
      event.preventDefault();
      this.store.undo();
      return;
    }
    if (modifier && key === 'y') {
      event.preventDefault();
      this.store.redo();
      return;
    }
    if (modifier && key === 'c') {
      event.preventDefault();
      this.store.copySelection();
      return;
    }
    if (modifier && key === 'x') {
      event.preventDefault();
      this.store.copySelection(true);
      return;
    }
    if (modifier && key === 'v') {
      event.preventDefault();
      this.store.pasteSelection();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.isCellishSelection()) {
      event.preventDefault();
      this.store.clearSelectedCells();
    }
  }

  private isCellishSelection(): boolean {
    const kind = this.store.selection()?.kind;
    return kind === 'cell' || kind === 'range';
  }

  // ---------------------------------------------------------------------------
  // Deletion flow
  // ---------------------------------------------------------------------------

  protected queueTopicDelete(topicId: string): void {
    const topic = this.store.topicById(topicId);
    if (!topic) {
      return;
    }
    this.pendingDelete.set({ type: 'topic', topicId, displayName: topic.displayName });
  }

  protected queueNodeDelete(topicId: string, nodeId: string): void {
    const canKeepData = this.store.canOfferKeepDataOnDelete(topicId, nodeId);
    const isBranch = this.store.nodeIsBranch(topicId, nodeId);

    if (!isBranch && !canKeepData) {
      this.store.removeNode(topicId, nodeId);
      return;
    }

    this.pendingDelete.set({ type: 'node', topicId, nodeId, canKeepData });
  }

  protected queuePageDelete(pageId: string): void {
    const page = this.store.pages().find((candidate) => candidate.id === pageId);
    if (!page || this.store.pages().length <= 1) {
      return;
    }
    const cardCount = this.store.pageCardCount(pageId);
    if (cardCount === 0) {
      this.store.removePage(pageId);
      return;
    }
    this.pendingDelete.set({ type: 'page', pageId, name: page.name, cardCount });
  }

  protected confirmTitle(): string {
    switch (this.pendingDelete()?.type) {
      case 'topic':
        return 'Delete topic';
      case 'page':
        return 'Delete page';
      default:
        return 'Delete node';
    }
  }

  protected confirmMessage(): string {
    const pending = this.pendingDelete();
    if (!pending) {
      return '';
    }
    if (pending.type === 'topic') {
      return `Deleting “${pending.displayName}” removes its whole tree and table.`;
    }
    if (pending.type === 'page') {
      return `Deleting “${pending.name}” also deletes the ${pending.cardCount} card(s) on it — trees, tables and data included.`;
    }
    if (pending.canKeepData) {
      return 'Deleting this node also deletes everything under it. You can keep its table data under the parent node instead.';
    }
    return 'Deleting this node removes all of its descendants and their rows.';
  }

  protected confirmSecondaryLabel(): string {
    const pending = this.pendingDelete();
    return pending?.type === 'node' && pending.canKeepData ? 'Delete and keep data' : '';
  }

  protected confirmDelete(): void {
    const pending = this.pendingDelete();
    if (!pending) {
      return;
    }
    if (pending.type === 'topic') {
      this.store.removeCard(pending.topicId);
    } else if (pending.type === 'page') {
      this.store.removePage(pending.pageId);
    } else {
      this.store.removeNode(pending.topicId, pending.nodeId);
    }
    this.pendingDelete.set(null);
  }

  protected confirmDeleteKeepingData(): void {
    const pending = this.pendingDelete();
    if (pending?.type !== 'node' || !pending.canKeepData) {
      return;
    }
    this.store.removeNode(pending.topicId, pending.nodeId, { keepDataInParent: true });
    this.pendingDelete.set(null);
  }

  // ---------------------------------------------------------------------------
  // Import / export
  // ---------------------------------------------------------------------------

  protected exportJson(): void {
    const json = this.store.exportDocument();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.exportFileName(this.store.title())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  protected importJson(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    void file
      .text()
      .then((text) => {
        const result = this.store.importDocument(text);
        this.showToast(result.ok, result.ok ? 'Imported.' : (result.error ?? 'Import failed.'));
      })
      .catch(() => this.showToast(false, 'Unable to read JSON file.'))
      .finally(() => {
        input.value = '';
      });
  }

  protected showToast(ok: boolean, text: string): void {
    this.toast.set({ ok, text });
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => {
      this.toast.set(null);
      this.toastTimer = null;
    }, 2500);
  }

  private exportFileName(title: string): string {
    const base = title.trim() || 'Untitled';
    const sanitized = base
      .replaceAll(/[/\\?%*:|"<>]/g, '_')
      .replaceAll(/\s+/g, ' ')
      .trim()
      .replace(/\.+$/, '');
    return sanitized.length > 0 ? sanitized : 'Untitled';
  }
}
