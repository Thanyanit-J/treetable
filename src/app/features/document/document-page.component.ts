import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DocumentStoreService, RefNameTarget } from '../../core/store/document-store.service';
import { TopicEvaluation } from '../../core/engine/formula-evaluator';
import { CardV2, findNodeAndParent } from '../../core/model/document.model';
import { ConfirmDialogComponent } from './ui/confirm-dialog.component';
import { RefNameDialogComponent } from './ui/ref-name-dialog.component';
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

type PendingDelete = PendingDeleteTopic | PendingDeleteNode;

interface Toast {
  ok: boolean;
  text: string;
}

@Component({
  selector: 'app-document-page',
  imports: [
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    ConfirmDialogComponent,
    RefNameDialogComponent,
    TopicCardComponent,
  ],
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
  template: `
    <main class="mx-auto min-h-dvh p-4 sm:p-6 lg:p-8">
      <header class="mb-4 rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <input
            class="min-w-0 flex-1 basis-64 cursor-text rounded-md border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold tracking-tight text-slate-900 transition hover:border-sky-200 focus:border-sky-300 focus-visible:outline-none"
            [value]="store.title()"
            aria-label="Document title"
            (blur)="commitTitle($event)"
            (keydown.enter)="commitTitleAndBlur($event)"
            (keydown.escape)="revertTitle($event)"
          />
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
              (click)="store.addTopic()"
            >
              + Topic
            </button>
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
            <button type="button" class="toolbar-button" (click)="exportJson()">Export JSON</button>
            <label class="toolbar-button cursor-pointer">
              Import JSON
              <input
                class="sr-only"
                type="file"
                accept="application/json"
                (change)="importJson($event)"
              />
            </label>
          </div>
        </div>
      </header>

      @if (store.cards().length === 0) {
        <section
          class="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center"
        >
          <p class="text-sm text-slate-600">This document has no topics yet.</p>
          <button
            type="button"
            class="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
            (click)="store.addTopic()"
          >
            Add your first topic
          </button>
        </section>
      } @else {
        <div
          cdkDropList
          cdkDropListOrientation="horizontal"
          class="flex items-start gap-4 overflow-x-auto pb-4"
          (cdkDropListDropped)="onCardDrop($event)"
        >
          @for (card of store.cards(); track card.id) {
            <div cdkDrag [cdkDragData]="card" class="group/card relative shrink-0">
              <button
                cdkDragHandle
                type="button"
                class="absolute right-2 top-2 z-20 flex h-6 w-6 cursor-grab items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-600 group-hover/card:opacity-100"
                [attr.aria-label]="'Drag topic ' + card.displayName"
              >
                <span aria-hidden="true">⠿</span>
              </button>
              <app-topic-card
                [topic]="card"
                [evaluation]="evaluationFor(card.id)"
                (requestDeleteTopic)="queueTopicDelete($event)"
                (requestDeleteNode)="queueNodeDelete($event.topicId, $event.nodeId)"
                (requestEditRefName)="openRefNameDialog($event)"
                (notify)="showToast(false, $event)"
              />
            </div>
          }
        </div>
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
    </main>

    <app-confirm-dialog
      [open]="pendingDelete() !== null"
      [title]="confirmTitle()"
      [message]="confirmMessage()"
      [secondaryLabel]="confirmSecondaryLabel()"
      (confirmed)="confirmDelete()"
      (secondaryConfirmed)="confirmDeleteKeepingData()"
      (cancelled)="pendingDelete.set(null)"
    />

    <app-ref-name-dialog
      [open]="refNameTarget() !== null"
      [kind]="refNameTarget()?.kind ?? 'node'"
      [displayName]="refNameDisplayName()"
      [currentRefName]="refNameCurrent()"
      [errorMessage]="refNameError()"
      (save)="saveRefName($event)"
      (cancelled)="closeRefNameDialog()"
    />
  `,
  styles: `
    .toolbar-button {
      border-radius: 0.5rem;
      border: 1px solid var(--color-slate-300);
      background: white;
      padding: 0.5rem 0.75rem;
      font-size: 0.875rem;
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
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentPageComponent {
  protected readonly store = inject(DocumentStoreService);

  protected readonly pendingDelete = signal<PendingDelete | null>(null);
  protected readonly toast = signal<Toast | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly emptyEvaluation: TopicEvaluation = { computedCells: new Map() };
  protected readonly evaluations = computed(() => this.store.evaluations());

  protected evaluationFor(cardId: string): TopicEvaluation {
    return this.evaluations().get(cardId) ?? this.emptyEvaluation;
  }

  protected onCardDrop(event: CdkDragDrop<unknown>): void {
    const card = event.item.data as CardV2 | undefined;
    if (card && event.previousIndex !== event.currentIndex) {
      this.store.moveCard(card.id, event.currentIndex);
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
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'z' && event.shiftKey) {
      event.preventDefault();
      this.store.redo();
    } else if (key === 'z') {
      event.preventDefault();
      this.store.undo();
    } else if (key === 'y') {
      event.preventDefault();
      this.store.redo();
    }
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

  protected confirmTitle(): string {
    return this.pendingDelete()?.type === 'topic' ? 'Delete topic' : 'Delete node';
  }

  protected confirmMessage(): string {
    const pending = this.pendingDelete();
    if (!pending) {
      return '';
    }
    if (pending.type === 'topic') {
      return `Deleting “${pending.displayName}” removes its whole tree and table.`;
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
  // Reference Name editing
  // ---------------------------------------------------------------------------

  protected readonly refNameTarget = signal<RefNameTarget | null>(null);
  protected readonly refNameError = signal<string | null>(null);

  protected readonly refNameDisplayName = computed(() => {
    const target = this.refNameTarget();
    if (!target) {
      return '';
    }
    const topic = this.store.topicById(target.topicId);
    if (!topic) {
      return '';
    }
    if (target.kind === 'topic') {
      return topic.displayName;
    }
    if (target.kind === 'column') {
      return topic.columns.find((column) => column.id === target.entityId)?.displayName ?? '';
    }
    return findNodeAndParent(topic.children, target.entityId)?.node.displayName ?? '';
  });

  protected readonly refNameCurrent = computed(() => {
    const target = this.refNameTarget();
    if (!target) {
      return '';
    }
    const topic = this.store.topicById(target.topicId);
    if (!topic) {
      return '';
    }
    if (target.kind === 'topic') {
      return topic.refName;
    }
    if (target.kind === 'column') {
      return topic.columns.find((column) => column.id === target.entityId)?.refName ?? '';
    }
    return findNodeAndParent(topic.children, target.entityId)?.node.refName ?? '';
  });

  protected openRefNameDialog(target: RefNameTarget): void {
    this.refNameError.set(null);
    this.refNameTarget.set(target);
  }

  protected closeRefNameDialog(): void {
    this.refNameTarget.set(null);
    this.refNameError.set(null);
  }

  protected saveRefName(nextRefName: string): void {
    const target = this.refNameTarget();
    if (!target) {
      return;
    }
    const result = this.store.setRefName(target, nextRefName);
    if (!result.ok) {
      this.refNameError.set(result.error ?? 'Invalid reference name.');
      return;
    }
    this.closeRefNameDialog();
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
