import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ColumnManagerComponent } from './components/column-manager.component';
import { ConfirmDialogComponent } from './components/confirm-dialog.component';
import { TreeCanvasComponent } from './components/tree-canvas.component';
import { ImportResult } from './models/tree-table.model';
import { TreeTableStoreService } from './services/tree-table-store.service';

interface PendingDeleteTopic {
  type: 'topic';
  topicId: string;
}

interface PendingDeleteSubtopic {
  type: 'subtopic';
  topicId: string;
  subtopicId: string;
}

type PendingDelete = PendingDeleteTopic | PendingDeleteSubtopic;

@Component({
  selector: 'app-tree-graph-page',
  imports: [ColumnManagerComponent, TreeCanvasComponent, ConfirmDialogComponent],
  template: `
    <main class="mx-auto max-w-[1220px] p-4 sm:p-6 lg:p-8">
      <section class="mb-4 rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Graph-First TreeTable</h1>
            <p class="text-sm text-slate-600">
              Visual topic tree with attached editable row cards and formula support.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              (click)="store.addTopic()"
              class="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
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

        @if (importFeedback()) {
          <p
            class="mt-3 rounded-lg px-3 py-2 text-sm"
            [class.bg-emerald-50]="importFeedback()?.ok"
            [class.text-emerald-800]="importFeedback()?.ok"
            [class.bg-rose-50]="!importFeedback()?.ok"
            [class.text-rose-700]="!importFeedback()?.ok"
            aria-live="polite"
          >
            {{ importFeedback()?.ok ? 'Import successful.' : importFeedback()?.error }}
          </p>
        }
      </section>

      <div class="grid gap-4 lg:grid-cols-[1fr_360px]">
        <app-tree-canvas
          [topics]="store.topics()"
          [columns]="store.columns()"
          [selectedNodeId]="store.selectedNodeId()"
          (addSubtopic)="store.addSubtopic($event)"
          (renameNode)="store.renameNode($event.nodeId, $event.label)"
          (toggleExpand)="store.toggleExpand($event)"
          (requestDeleteTopic)="queueTopicDelete($event)"
          (requestDeleteSubtopic)="queueSubtopicDelete($event.topicId, $event.subtopicId)"
          (setCell)="store.setCellRaw($event.nodeId, $event.columnId, $event.raw)"
          (selectNode)="store.selectNode($event)"
          (moveTopic)="store.moveTopic($event.topicId, $event.toIndex)"
          (moveSubtopic)="store.moveSubtopic($event.topicId, $event.subtopicId, $event.toIndex)"
        />

        <app-column-manager
          [columns]="store.columns()"
          (add)="store.addColumn($event.name, $event.type)"
          (rename)="store.renameColumn($event.columnId, $event.name)"
          (remove)="store.removeColumn($event)"
        />
      </div>
    </main>

    <app-confirm-dialog
      [open]="isDeleteDialogOpen()"
      title="Delete node"
      [message]="deleteMessage()"
      (confirmed)="confirmDelete()"
      (cancelled)="pendingDelete.set(null)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreeGraphPageComponent {
  readonly store = inject(TreeTableStoreService);

  protected readonly pendingDelete = signal<PendingDelete | null>(null);
  protected readonly importFeedback = signal<ImportResult | null>(null);

  protected readonly isDeleteDialogOpen = computed(() => this.pendingDelete() !== null);
  protected readonly deleteMessage = computed(() => {
    const pending = this.pendingDelete();
    if (!pending) {
      return 'Are you sure you want to delete this node?';
    }

    if (pending.type === 'topic') {
      return 'Deleting a topic removes all its subtopics and row cards.';
    }

    return 'Deleting a subtopic removes its node and attached row card.';
  });

  queueTopicDelete(topicId: string): void {
    this.pendingDelete.set({ type: 'topic', topicId });
  }

  queueSubtopicDelete(topicId: string, subtopicId: string): void {
    this.pendingDelete.set({ type: 'subtopic', topicId, subtopicId });
  }

  confirmDelete(): void {
    const pending = this.pendingDelete();
    if (!pending) {
      return;
    }

    if (pending.type === 'topic') {
      this.store.removeTopic(pending.topicId);
    } else {
      this.store.removeSubtopic(pending.topicId, pending.subtopicId);
    }

    this.pendingDelete.set(null);
  }

  importJson(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const result = this.store.importState(text);
      this.importFeedback.set(result);
      input.value = '';
    };
    reader.readAsText(file);
  }

  exportJson(): void {
    const data = this.store.exportState();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'treetable.json';
    link.click();
    URL.revokeObjectURL(url);
  }
}
