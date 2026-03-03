import { CdkDragDrop, CdkDragEnd, CdkDragStart, DragDropModule } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TreeSubtopic, TreeTopic } from '../models/tree-table.model';
import { acquireMenuScrollLock, releaseMenuScrollLock } from '../utils/menu-scroll-lock';

interface TopicMenuTarget {
  kind: 'topic';
  topicId: string;
}

interface SubtopicMenuTarget {
  kind: 'subtopic';
  topicId: string;
  subtopicId: string;
}

type NodeMenuTarget = TopicMenuTarget | SubtopicMenuTarget;

@Component({
  selector: 'app-tree-canvas',
  imports: [DragDropModule, FormsModule],
  host: {
    '(document:keydown.escape)': 'closeNodeMenu()',
    '(document:mousedown)': 'onDocumentMouseDown($event)',
    '(document:contextmenu)': 'onDocumentContextMenu($event)',
    '(document:tree-graph-menu-opened)': 'onGlobalMenuOpened($event)',
  },
  template: `
    <section #canvasRoot class="h-full p-1" aria-label="Tree graph canvas">
      <article class="space-y-3">
        <div class="relative flex items-center gap-2">
          <div
            class="relative rounded-full border border-sky-300 bg-sky-100"
            [style.min-width.ch]="12"
            [style.width.ch]="nodeWidthCh(topic().label)"
            [class.ring-2]="selectedNodeId() === topic().id"
            [class.ring-sky-400]="selectedNodeId() === topic().id"
            (contextmenu)="openTopicMenu($event, topic().id)"
          >
            <input
              [ngModel]="nodeInputValue(topic().id, topic().label)"
              (focus)="onNodeFocus(topic().id, topic().label)"
              (ngModelChange)="onNodeModelChange(topic().id, $event)"
              (blur)="onNodeBlur($event, topic().id, topic().label)"
              (keydown.enter)="onNodeEnter($event, topic().id, topic().label)"
              (keydown.escape)="onNodeEscape($event, topic().id, topic().label)"
              class="block min-h-[40px] w-full rounded-full border-0 bg-transparent px-2 py-2 text-center text-sm font-semibold text-slate-800 focus-visible:outline-none"
              [attr.aria-label]="'Topic label: ' + topic().label"
            />
          </div>
        </div>

        <div
          cdkDropList
          [cdkDropListData]="topic().children"
          (cdkDropListDropped)="onSubtopicDrop(topic().id, $event)"
          class="space-y-3 pl-10"
          [attr.aria-label]="'Subtopics for ' + topic().label"
        >
          @for (subtopic of topic().children; track subtopic.id) {
            <div
              cdkDrag
              cdkDragPreviewClass="drag-preview-solid"
              [cdkDragData]="subtopic"
              (cdkDragStarted)="onSubtopicDragStarted($event)"
              (cdkDragEnded)="onSubtopicDragEnded($event)"
              class="relative flex items-center gap-2"
            >
              <div class="absolute -left-5 top-1/2 h-px w-5 -translate-y-1/2 bg-slate-300"></div>

              <div
                class="cursor-grab rounded-xl border border-amber-300 bg-amber-100"
                [style.min-width.ch]="10"
                [style.width.ch]="nodeWidthCh(subtopic.label)"
                [class.ring-2]="selectedNodeId() === subtopic.id"
                [class.ring-amber-400]="selectedNodeId() === subtopic.id"
                (contextmenu)="openSubtopicMenu($event, topic().id, subtopic.id)"
              >
                <input
                  [ngModel]="nodeInputValue(subtopic.id, subtopic.label)"
                  (focus)="onNodeFocus(subtopic.id, subtopic.label)"
                  (ngModelChange)="onNodeModelChange(subtopic.id, $event)"
                  (blur)="onNodeBlur($event, subtopic.id, subtopic.label)"
                  (keydown.enter)="onNodeEnter($event, subtopic.id, subtopic.label)"
                  (keydown.escape)="onNodeEscape($event, subtopic.id, subtopic.label)"
                  class="block min-h-[40px] w-full rounded-xl border-0 bg-transparent px-2 py-2 text-center text-sm font-medium text-slate-800 focus-visible:outline-none"
                  [attr.aria-label]="'Subtopic label: ' + subtopic.label"
                />
              </div>
            </div>
          }
        </div>
      </article>

      @if (menuOpen()) {
        <section
          #nodeMenu
          class="fixed z-50 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
          [style.left.px]="menuX()"
          [style.top.px]="menuY()"
          role="menu"
          aria-label="Node actions"
        >
          @if (menuTarget()?.kind === 'topic') {
            <button
              (click)="onTopicMenuAction('addSubtopic')"
              class="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              role="menuitem"
              type="button"
            >
              Add subtopic
            </button>
            <button
              (click)="onTopicMenuAction('deleteTopic')"
              class="block w-full rounded px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
              role="menuitem"
              type="button"
            >
              Delete topic
            </button>
          }

          @if (menuTarget()?.kind === 'subtopic') {
            <button
              (click)="onSubtopicMenuAction('focusRow')"
              class="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              role="menuitem"
              type="button"
            >
              Focus row
            </button>
            <button
              (click)="onSubtopicMenuAction('addSubtopic')"
              class="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              role="menuitem"
              type="button"
            >
              Add subtopic
            </button>
            <button
              (click)="onSubtopicMenuAction('deleteSubtopic')"
              class="block w-full rounded px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
              role="menuitem"
              type="button"
            >
              Delete subtopic
            </button>
          }
        </section>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreeCanvasComponent {
  readonly topic = input.required<TreeTopic>();
  readonly selectedNodeId = input<string | null>(null);

  readonly addSubtopic = output<string>();
  readonly renameNode = output<{ nodeId: string; label: string }>();
  readonly requestDeleteTopic = output<string>();
  readonly requestDeleteSubtopic = output<{ topicId: string; subtopicId: string }>();
  readonly selectNode = output<string | null>();
  readonly moveSubtopic = output<{ topicId: string; subtopicId: string; toIndex: number }>();

  protected readonly menuOpen = signal(false);
  protected readonly menuX = signal(0);
  protected readonly menuY = signal(0);
  protected readonly menuTarget = signal<NodeMenuTarget | null>(null);
  protected readonly editingNodeId = signal<string | null>(null);
  protected readonly editingNodeLabel = signal('');
  private readonly canvasRootRef = viewChild<ElementRef<HTMLElement>>('canvasRoot');
  private readonly nodeMenuRef = viewChild<ElementRef<HTMLElement>>('nodeMenu');
  private isScrollLocked = false;
  private isDraggingSubtopic = false;
  private suppressNodeFocusUntil = 0;
  private readonly menuOwnerId = `tree-canvas-${crypto.randomUUID()}`;

  onSubtopicDrop(topicId: string, event: CdkDragDrop<TreeSubtopic[]>): void {
    if (event.previousIndex === event.currentIndex) {
      return;
    }

    const moved = event.container.data[event.previousIndex];
    if (!moved) {
      return;
    }

    this.moveSubtopic.emit({ topicId, subtopicId: moved.id, toIndex: event.currentIndex });
  }

  openTopicMenu(event: MouseEvent, topicId: string): void {
    event.preventDefault();
    this.menuTarget.set({ kind: 'topic', topicId });
    this.menuX.set(event.clientX);
    this.menuY.set(event.clientY);
    this.menuOpen.set(true);
    this.ensureScrollLock();
    this.broadcastMenuOpened();
  }

  openSubtopicMenu(event: MouseEvent, topicId: string, subtopicId: string): void {
    event.preventDefault();
    this.menuTarget.set({ kind: 'subtopic', topicId, subtopicId });
    this.menuX.set(event.clientX);
    this.menuY.set(event.clientY);
    this.menuOpen.set(true);
    this.ensureScrollLock();
    this.broadcastMenuOpened();
  }

  closeNodeMenu(): void {
    this.releaseScrollLock();
    this.menuOpen.set(false);
  }

  onTopicMenuAction(action: 'addSubtopic' | 'deleteTopic'): void {
    const target = this.menuTarget();
    if (target?.kind !== 'topic') {
      this.closeNodeMenu();
      return;
    }

    if (action === 'addSubtopic') {
      this.addSubtopic.emit(target.topicId);
    } else {
      this.requestDeleteTopic.emit(target.topicId);
    }

    this.closeNodeMenu();
  }

  onSubtopicMenuAction(action: 'focusRow' | 'deleteSubtopic' | 'addSubtopic'): void {
    const target = this.menuTarget();
    if (target?.kind !== 'subtopic') {
      this.closeNodeMenu();
      return;
    }

    if (action === 'focusRow') {
      this.selectNode.emit(target.subtopicId);
    } else if (action === 'addSubtopic') {
      this.addSubtopic.emit(target.topicId);
    } else {
      this.requestDeleteSubtopic.emit({
        topicId: target.topicId,
        subtopicId: target.subtopicId,
      });
    }

    this.closeNodeMenu();
  }

  protected onNodeFocus(nodeId: string, label: string): void {
    if (this.isDraggingSubtopic || Date.now() < this.suppressNodeFocusUntil) {
      return;
    }

    this.selectNode.emit(nodeId);
    if (this.editingNodeId() === nodeId) {
      return;
    }
    this.editingNodeId.set(nodeId);
    this.editingNodeLabel.set(label);
  }

  protected onNodeModelChange(nodeId: string, label: string): void {
    if (this.editingNodeId() !== nodeId) {
      return;
    }
    this.editingNodeLabel.set(label);
  }

  protected onNodeBlur(event: FocusEvent, nodeId: string, originalLabel: string): void {
    if (this.editingNodeId() !== nodeId) {
      this.clearSelectionIfFocusLeftCanvas(event);
      return;
    }
    this.commitNodeRename(nodeId, originalLabel);
    this.clearSelectionIfFocusLeftCanvas(event);
  }

  protected onNodeEnter(event: Event, nodeId: string, originalLabel: string): void {
    event.preventDefault();
    if (this.editingNodeId() !== nodeId) {
      return;
    }
    this.commitNodeRename(nodeId, originalLabel);
    const input = event.target as HTMLInputElement | null;
    input?.blur();
  }

  protected onNodeEscape(event: Event, nodeId: string, originalLabel: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.editingNodeId() !== nodeId) {
      return;
    }

    this.editingNodeId.set(null);
    this.editingNodeLabel.set('');
    const input = event.target as HTMLInputElement | null;
    if (input) {
      input.value = originalLabel;
      input.blur();
    }
  }

  protected nodeInputValue(nodeId: string, label: string): string {
    if (this.editingNodeId() === nodeId) {
      return this.editingNodeLabel();
    }
    return label;
  }

  protected onSubtopicDragStarted(_event: CdkDragStart<TreeSubtopic>): void {
    this.isDraggingSubtopic = true;
    this.editingNodeId.set(null);
    this.editingNodeLabel.set('');
    const activeInput = document.activeElement as HTMLInputElement | null;
    if (activeInput?.tagName === 'INPUT') {
      activeInput.blur();
    }
  }

  protected onSubtopicDragEnded(_event: CdkDragEnd<TreeSubtopic>): void {
    this.isDraggingSubtopic = false;
    // Ignore synthetic focus/click transfer immediately after dropping.
    this.suppressNodeFocusUntil = Date.now() + 180;
  }

  private commitNodeRename(nodeId: string, originalLabel: string): void {
    const nextLabel = this.editingNodeLabel();
    if (nextLabel !== originalLabel) {
      this.renameNode.emit({ nodeId, label: nextLabel });
    }
    this.editingNodeId.set(null);
    this.editingNodeLabel.set('');
  }

  protected onDocumentMouseDown(event: MouseEvent): void {
    if (this.menuOpen()) {
      const menu = this.nodeMenuRef()?.nativeElement;
      const target = event.target as Node | null;
      if (!menu || !target || !menu.contains(target)) {
        this.closeNodeMenu();
      }
    }

    const root = this.canvasRootRef()?.nativeElement;
    const target = event.target as Node | null;
    if (!root || !target || root.contains(target)) {
      return;
    }
    this.selectNode.emit(null);
  }

  protected onDocumentContextMenu(event: MouseEvent): void {
    if (!this.menuOpen()) {
      return;
    }

    const root = this.canvasRootRef()?.nativeElement;
    const menu = this.nodeMenuRef()?.nativeElement;
    const target = event.target as Node | null;
    if (!target) {
      this.closeNodeMenu();
      return;
    }

    if (menu?.contains(target)) {
      return;
    }

    // Keep this canvas menu active when right-clicking inside the same canvas,
    // but close it when right-clicking another card/canvas.
    if (root?.contains(target)) {
      return;
    }

    this.closeNodeMenu();
  }

  protected onGlobalMenuOpened(event: Event): void {
    if (!this.menuOpen()) {
      return;
    }

    const ownerId = (event as CustomEvent<{ ownerId?: string }>).detail?.ownerId;
    if (!ownerId || ownerId === this.menuOwnerId) {
      return;
    }

    this.closeNodeMenu();
  }

  private clearSelectionIfFocusLeftCanvas(event: FocusEvent): void {
    const root = this.canvasRootRef()?.nativeElement;
    const relatedTarget = event.relatedTarget as Node | null;
    if (!root || (relatedTarget && root.contains(relatedTarget))) {
      return;
    }
    this.selectNode.emit(null);
  }

  protected nodeWidthCh(label: string): number {
    const base = Math.max(8, label.trim().length + 2);
    return Math.min(base, 40);
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
}
