import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmDialogComponent } from './components/confirm-dialog.component';
import { SubtopicTableComponent } from './components/subtopic-table.component';
import { TreeCanvasComponent } from './components/tree-canvas.component';
import { ImportResult, TreeTopic } from './models/tree-table.model';
import { TreeTableStoreService } from './services/tree-table-store.service';
import { acquireMenuScrollLock, releaseMenuScrollLock } from './utils/menu-scroll-lock';

interface PendingDeleteTopic {
  type: 'topic';
  topicId: string;
}

@Component({
  selector: 'app-tree-graph-page',
  imports: [FormsModule, DragDropModule, TreeCanvasComponent, SubtopicTableComponent, ConfirmDialogComponent],
  host: {
    '(window:resize)': 'onWindowResize()',
    '(document:mousedown)': 'onDocumentMouseDown($event)',
    '(document:keydown.escape)': 'closeTopicCardMenu()',
    '(document:tree-graph-menu-opened)': 'onGlobalMenuOpened($event)',
  },
  template: `
    <main
      class="tree-graph-page mx-auto p-4 sm:p-6 lg:p-8"
      style="
        --subtopic-node-height: 40px;
        --subtopic-gap: 13px;
        --subtopic-table-offset-top: 5px;
        --subtopic-table-header-height: 44px;
      "
    >
      <section class="mb-4 rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <input
              [ngModel]="titleInputValue()"
              (focus)="onTitleFocus()"
              (ngModelChange)="onTitleChange($event)"
              (blur)="onTitleBlur()"
              (keydown.enter)="onTitleEnter($event)"
              (keydown.escape)="onTitleEscape($event)"
              class="w-full min-w-0 cursor-text rounded-md border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold tracking-tight text-slate-900 transition hover:border-sky-200 focus:border-sky-300 focus-visible:outline-none"
              [class.border-sky-300]="editingTitle()"
              aria-label="Tree title"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              (click)="store.addTopic()"
              class="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
              type="button"
            >
              + Topic
            </button>
            <button
              (click)="store.undo()"
              [disabled]="!store.canUndo()"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              Undo
            </button>
            <button
              (click)="store.redo()"
              [disabled]="!store.canRedo()"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              Redo
            </button>
            <button
              (click)="exportJson()"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              type="button"
            >
              Export JSON
            </button>
            <label class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">
              Import JSON
              <input class="sr-only" type="file" accept="application/json" (change)="importJson($event)" />
            </label>
          </div>
        </div>

      </section>

      <div class="relative">
        <div #cardRail class="overflow-x-auto" (scroll)="onCardRailScroll()">
        <div
          cdkDropList
          cdkDropListOrientation="horizontal"
          [cdkDropListData]="store.topics()"
          (cdkDropListDropped)="onTopicCardDrop($event)"
          class="mb-5 flex w-max flex-nowrap items-start gap-4"
        >
          @for (topic of store.topics(); track topic.id) {
            <article
              cdkDrag
              cdkDragPreviewClass="drag-preview-solid"
              [cdkDragData]="topic"
              class="w-max shrink-0 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm"
              (contextmenu)="onTopicCardContextMenu($event, topic.id)"
            >
              <div class="flex flex-nowrap overflow-x-auto">
                <div class="w-max shrink-0">
                  <app-tree-canvas
                    [topic]="topic"
                    [selectedNodeId]="store.selectedNodeId()"
                    (addSubtopic)="store.addSubtopic($event)"
                    (renameNode)="store.renameNode($event.nodeId, $event.label)"
                    (requestDeleteTopic)="queueTopicDelete($event)"
                    (requestDeleteSubtopic)="queueSubtopicDelete($event.topicId, $event.subtopicId)"
                    (selectNode)="store.selectNode($event)"
                    (moveSubtopic)="store.moveSubtopic($event.topicId, $event.subtopicId, $event.toIndex)"
                  />
                </div>

                <div class="w-max shrink-0">
                  <app-subtopic-table
                    [topic]="topic"
                    [selectedNodeId]="store.selectedNodeId()"
                    (setCell)="store.setCellRaw($event.topicId, $event.subtopicId, $event.columnId, $event.raw)"
                    (selectNode)="store.selectNode($event)"
                    (insertColumn)="store.insertColumn($event.topicId, $event.referenceColumnId, $event.side)"
                    (deleteColumn)="onDeleteColumn($event.topicId, $event.columnId)"
                    (renameColumn)="store.renameColumn($event.topicId, $event.columnId, $event.name)"
                  />
                </div>
              </div>
            </article>
          }
        </div>
        </div>
        @if (showLeftOverflowShadow()) {
          <div class="pointer-events-none absolute bottom-5 left-0 top-0 w-10 bg-linear-to-r from-slate-700/35 to-transparent"></div>
        }
        @if (showRightOverflowShadow()) {
          <div class="pointer-events-none absolute bottom-5 right-0 top-0 w-10 bg-linear-to-l from-slate-700/35 to-transparent"></div>
        }
      </div>
      @if (topicCardMenuOpen()) {
        <section
          #topicCardMenu
          class="fixed z-50 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
          [style.left.px]="topicCardMenuX()"
          [style.top.px]="topicCardMenuY()"
          role="menu"
          aria-label="Topic card actions"
        >
          <button
            (click)="onTopicCardMenuAction('addSubtopic')"
            class="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
            role="menuitem"
            type="button"
          >
            Add subtopic
          </button>
          <button
            (click)="onTopicCardMenuAction('deleteTopic')"
            class="block w-full rounded px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
            role="menuitem"
            type="button"
          >
            Delete topic
          </button>
        </section>
      }

      @if (statusMessage()) {
        <div
          class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
          aria-live="polite"
        >
          <div
            class="pointer-events-auto rounded-lg px-4 py-2 text-sm font-medium shadow-lg ring-1"
            [class.bg-emerald-50]="statusMessage()?.ok"
            [class.text-emerald-800]="statusMessage()?.ok"
            [class.ring-emerald-200]="statusMessage()?.ok"
            [class.bg-rose-50]="!statusMessage()?.ok"
            [class.text-rose-700]="!statusMessage()?.ok"
            [class.ring-rose-200]="!statusMessage()?.ok"
          >
            {{ statusMessage()?.ok ? 'Done.' : statusMessage()?.error }}
          </div>
        </div>
      }
    </main>

    <app-confirm-dialog
      [open]="pendingDelete() !== null"
      title="Delete node"
      message="Deleting a topic removes all its subtopics and table rows."
      (confirmed)="confirmDelete()"
      (cancelled)="pendingDelete.set(null)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreeGraphPageComponent {
  readonly store = inject(TreeTableStoreService);

  protected readonly pendingDelete = signal<PendingDeleteTopic | null>(null);
  protected readonly statusMessage = signal<ImportResult | null>(null);
  protected readonly editingTitle = signal(false);
  protected readonly titleDraft = signal('');
  protected readonly showLeftOverflowShadow = signal(false);
  protected readonly showRightOverflowShadow = signal(false);
  protected readonly topicCardMenuOpen = signal(false);
  protected readonly topicCardMenuX = signal(0);
  protected readonly topicCardMenuY = signal(0);
  protected readonly topicCardMenuTopicId = signal<string | null>(null);
  private readonly cardRailRef = viewChild<ElementRef<HTMLElement>>('cardRail');
  private readonly topicCardMenuRef = viewChild<ElementRef<HTMLElement>>('topicCardMenu');
  private readonly menuOwnerId = `tree-graph-page-${crypto.randomUUID()}`;
  private statusToastTimer: ReturnType<typeof setTimeout> | null = null;
  private isScrollLocked = false;

  constructor() {
    effect(() => {
      this.store.topics();
      setTimeout(() => this.updateCardRailOverflow(), 0);
    });
  }

  protected titleInputValue(): string {
    if (this.editingTitle()) {
      return this.titleDraft();
    }
    return this.store.title();
  }

  protected onTitleFocus(): void {
    if (this.editingTitle()) {
      return;
    }
    this.editingTitle.set(true);
    this.titleDraft.set(this.store.title());
  }

  protected onTitleChange(value: string): void {
    if (!this.editingTitle()) {
      return;
    }
    this.titleDraft.set(value);
  }

  protected onTitleBlur(): void {
    this.commitTitle();
  }

  protected onTitleEnter(event: Event): void {
    event.preventDefault();
    this.commitTitle();
    const input = event.target as HTMLInputElement | null;
    input?.blur();
  }

  protected onTitleEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.editingTitle.set(false);
    this.titleDraft.set('');
    const input = event.target as HTMLInputElement | null;
    if (input) {
      input.value = this.store.title();
      input.blur();
    }
  }

  protected onTopicCardDrop(event: CdkDragDrop<TreeTopic[]>): void {
    if (event.previousIndex === event.currentIndex) {
      return;
    }

    const movedTopic = event.container.data[event.previousIndex];
    if (!movedTopic) {
      return;
    }

    this.store.moveTopicCard(movedTopic.id, event.currentIndex);
    setTimeout(() => this.updateCardRailOverflow(), 0);
  }

  protected onCardRailScroll(): void {
    this.updateCardRailOverflow();
  }

  protected onWindowResize(): void {
    this.updateCardRailOverflow();
  }

  protected onTopicCardContextMenu(event: MouseEvent, topicId: string): void {
    if (event.defaultPrevented) {
      return;
    }

    event.preventDefault();
    this.topicCardMenuTopicId.set(topicId);
    this.topicCardMenuX.set(event.clientX);
    this.topicCardMenuY.set(event.clientY);
    this.topicCardMenuOpen.set(true);
    this.ensureScrollLock();
    this.broadcastMenuOpened();
  }

  protected onTopicCardMenuAction(action: 'addSubtopic' | 'deleteTopic'): void {
    const topicId = this.topicCardMenuTopicId();
    if (!topicId) {
      this.closeTopicCardMenu();
      return;
    }

    if (action === 'addSubtopic') {
      this.store.addSubtopic(topicId);
    } else {
      this.queueTopicDelete(topicId);
    }
    this.closeTopicCardMenu();
  }

  queueTopicDelete(topicId: string): void {
    this.pendingDelete.set({ type: 'topic', topicId });
  }

  queueSubtopicDelete(topicId: string, subtopicId: string): void {
    this.store.removeSubtopic(topicId, subtopicId);
  }

  confirmDelete(): void {
    const pending = this.pendingDelete();
    if (!pending) {
      return;
    }

    this.store.removeTopic(pending.topicId);

    this.pendingDelete.set(null);
  }

  importJson(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    void file
      .text()
      .then((text) => {
      const result = this.store.importState(text);
      this.showStatusMessage(result);
      })
      .catch(() => {
        this.showStatusMessage({ ok: false, error: 'Unable to read JSON file.' });
      })
      .finally(() => {
        input.value = '';
      });
  }

  exportJson(): void {
    const data = this.store.exportState();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.buildExportFileName(this.store.title())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  onDeleteColumn(topicId: string, columnId: string): void {
    const result = this.store.deleteColumn(topicId, columnId);
    if (result) {
      this.showStatusMessage(result);
    }
  }

  private commitTitle(): void {
    if (!this.editingTitle()) {
      return;
    }
    this.store.setTitle(this.titleDraft());
    this.editingTitle.set(false);
    this.titleDraft.set('');
  }

  protected closeTopicCardMenu(): void {
    this.releaseScrollLock();
    this.topicCardMenuOpen.set(false);
    this.topicCardMenuTopicId.set(null);
  }

  protected onDocumentMouseDown(event: MouseEvent): void {
    if (!this.topicCardMenuOpen()) {
      return;
    }

    const menu = this.topicCardMenuRef()?.nativeElement;
    const target = event.target as Node | null;
    if (!menu || !target || !menu.contains(target)) {
      this.closeTopicCardMenu();
    }
  }

  protected onGlobalMenuOpened(event: Event): void {
    if (!this.topicCardMenuOpen()) {
      return;
    }

    const ownerId = (event as CustomEvent<{ ownerId?: string }>).detail?.ownerId;
    if (!ownerId || ownerId === this.menuOwnerId) {
      return;
    }

    this.closeTopicCardMenu();
  }

  private updateCardRailOverflow(): void {
    const rail = this.cardRailRef()?.nativeElement;
    if (!rail) {
      this.showLeftOverflowShadow.set(false);
      this.showRightOverflowShadow.set(false);
      return;
    }

    const hasOverflow = rail.scrollWidth > rail.clientWidth + 1;
    if (!hasOverflow) {
      this.showLeftOverflowShadow.set(false);
      this.showRightOverflowShadow.set(false);
      return;
    }
    const atStart = rail.scrollLeft <= 1;
    const atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1;
    this.showLeftOverflowShadow.set(!atStart);
    this.showRightOverflowShadow.set(!atEnd);
  }

  private showStatusMessage(result: ImportResult): void {
    this.statusMessage.set(result);
    if (this.statusToastTimer) {
      clearTimeout(this.statusToastTimer);
    }
    this.statusToastTimer = setTimeout(() => {
      this.statusMessage.set(null);
      this.statusToastTimer = null;
    }, 2500);
  }

  private broadcastMenuOpened(): void {
    document.dispatchEvent(
      new CustomEvent<{ ownerId: string }>('tree-graph-menu-opened', {
        detail: { ownerId: this.menuOwnerId },
      }),
    );
  }

  private ensureScrollLock(): void {
    if (this.isScrollLocked) {
      return;
    }
    acquireMenuScrollLock();
    this.isScrollLocked = true;
  }

  private releaseScrollLock(): void {
    if (!this.isScrollLocked) {
      return;
    }
    releaseMenuScrollLock();
    this.isScrollLocked = false;
  }

  private buildExportFileName(title: string): string {
    const trimmed = title.trim();
    const base = trimmed.length > 0 ? trimmed : 'Untitled';
    const sanitized = base
      .replaceAll(/[/\\?%*:|"<>]/g, '_')
      .replaceAll(/\s+/g, ' ')
      .trim()
      .replace(/\.+$/, '');
    return sanitized.length > 0 ? sanitized : 'Untitled';
  }
}
