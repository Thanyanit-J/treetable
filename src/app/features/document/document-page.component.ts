import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  CdkDropListGroup,
} from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    CdkDropListGroup,
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
      <app-page-sidebar (requestDeletePage)="queuePageDelete($event)" />

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
            <!-- One drop-list group: each stack is a vertical list (drop under a
                 card to stack them); the gaps are lists too — dropping there
                 puts the card into its own new column. -->
            <div cdkDropListGroup class="flex h-full min-h-full items-stretch p-3">
              <div
                cdkDropList
                [cdkDropListData]="'new:0'"
                class="rail-gap w-6 shrink-0"
                (cdkDropListDropped)="onRailDrop($event)"
              ></div>
              @for (stack of store.activeStacks(); track stack.id; let stackIndex = $index) {
                <div
                  cdkDropList
                  [cdkDropListData]="stack.id"
                  class="flex shrink-0 flex-col gap-3"
                  (cdkDropListDropped)="onRailDrop($event)"
                >
                  @for (card of stack.cards; track card.id) {
                    <div
                      cdkDrag
                      [cdkDragData]="card.id"
                      class="group/card relative flex min-h-0 flex-1"
                    >
                      <button
                        cdkDragHandle
                        type="button"
                        class="absolute left-1 top-1 z-30 flex h-6 w-6 cursor-grab items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-600 group-hover/card:opacity-100"
                        [attr.aria-label]="'Drag card ' + cardLabel(card)"
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
                    </div>
                  }
                </div>
                <div
                  cdkDropList
                  [cdkDropListData]="'new:' + (stackIndex + 1)"
                  class="rail-gap w-6 shrink-0"
                  (cdkDropListDropped)="onRailDrop($event)"
                ></div>
              }
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
    .rail-gap {
      border-radius: 0.5rem;
      transition: background-color 0.15s ease;
    }
    .rail-gap.cdk-drop-list-receiving,
    .rail-gap.cdk-drop-list-dragging {
      background: var(--color-sky-100);
      outline: 2px dashed var(--color-sky-300);
      outline-offset: -2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentPageComponent {
  protected readonly store = inject(DocumentStoreService);

  protected readonly pendingDelete = signal<PendingDelete | null>(null);
  protected readonly detailsOpen = signal(true);
  protected readonly toast = signal<Toast | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** Routes rail drops: into a stack (reorder/stack) or a gap (new column). */
  protected onRailDrop(event: CdkDragDrop<string>): void {
    const cardId = event.item.data;
    const target = event.container.data;
    if (typeof cardId !== 'string' || typeof target !== 'string') {
      return;
    }
    if (target.startsWith('new:')) {
      this.store.moveCardToNewStack(cardId, this.store.activePage().id, Number(target.slice(4)));
      return;
    }
    if (event.previousContainer === event.container && event.previousIndex === event.currentIndex) {
      return;
    }
    this.store.moveCardToStack(cardId, target, event.currentIndex);
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
