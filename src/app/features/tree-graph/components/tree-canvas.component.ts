import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TreeSubtopic, TreeTopic } from '../models/tree-table.model';

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
  },
  template: `
    <section
      #canvasRoot
      class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm"
      aria-label="Tree graph canvas"
    >
      <div
        cdkDropList
        [cdkDropListData]="topics()"
        (cdkDropListDropped)="onTopicDrop($event)"
        class="space-y-4"
      >
        @for (topic of topics(); track topic.id) {
          <article cdkDrag [cdkDragData]="topic" class="space-y-3">
            <div class="relative flex items-center gap-2">
              <button
                class="cursor-grab rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600"
                cdkDragHandle
                aria-label="Drag topic"
                type="button"
              >
                ↕
              </button>

              <div
                class="relative min-w-0 flex-1 rounded-full border border-sky-300 bg-sky-100"
                [class.ring-2]="selectedNodeId() === topic.id"
                [class.ring-sky-400]="selectedNodeId() === topic.id"
                (contextmenu)="openTopicMenu($event, topic.id)"
              >
                <input
                  [ngModel]="nodeInputValue(topic.id, topic.label)"
                  (focus)="onNodeFocus(topic.id, topic.label)"
                  (ngModelChange)="onNodeModelChange(topic.id, $event)"
                  (blur)="onNodeBlur($event, topic.id, topic.label)"
                  (keydown.enter)="onNodeEnter($event, topic.id, topic.label)"
                  (keydown.escape)="onNodeEscape($event, topic.id, topic.label)"
                  class="block min-h-[40px] w-full rounded-full border-0 bg-transparent px-3 py-2 text-sm font-semibold text-slate-800 focus-visible:outline-none"
                  [attr.aria-label]="'Topic label: ' + topic.label"
                />
              </div>
            </div>

            <div
              cdkDropList
              [cdkDropListData]="topic.children"
              (cdkDropListDropped)="onSubtopicDrop(topic.id, $event)"
              class="space-y-3 pl-10"
              [attr.aria-label]="'Subtopics for ' + topic.label"
            >
              @for (subtopic of topic.children; track subtopic.id) {
                <div cdkDrag [cdkDragData]="subtopic" class="relative flex items-center gap-2">
                  <div class="absolute -left-5 top-1/2 h-px w-5 -translate-y-1/2 bg-slate-300"></div>
                  <button
                    cdkDragHandle
                    class="cursor-grab rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600"
                    aria-label="Drag subtopic"
                    type="button"
                  >
                    ↕
                  </button>

                  <div
                    class="min-w-0 flex-1 rounded-xl border border-amber-300 bg-amber-100"
                    [class.ring-2]="selectedNodeId() === subtopic.id"
                    [class.ring-amber-400]="selectedNodeId() === subtopic.id"
                    (contextmenu)="openSubtopicMenu($event, topic.id, subtopic.id)"
                  >
                    <input
                      [ngModel]="nodeInputValue(subtopic.id, subtopic.label)"
                      (focus)="onNodeFocus(subtopic.id, subtopic.label)"
                      (ngModelChange)="onNodeModelChange(subtopic.id, $event)"
                      (blur)="onNodeBlur($event, subtopic.id, subtopic.label)"
                      (keydown.enter)="onNodeEnter($event, subtopic.id, subtopic.label)"
                      (keydown.escape)="onNodeEscape($event, subtopic.id, subtopic.label)"
                      class="block min-h-[40px] w-full rounded-xl border-0 bg-transparent px-3 py-2 text-sm font-medium text-slate-800 focus-visible:outline-none"
                      [attr.aria-label]="'Subtopic label: ' + subtopic.label"
                    />
                  </div>
                </div>
              }
            </div>
          </article>
        }
      </div>

      @if (menuOpen()) {
        <div class="fixed inset-0 z-40" (click)="closeNodeMenu()" aria-hidden="true"></div>
        <section
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
  readonly topics = input.required<TreeTopic[]>();
  readonly selectedNodeId = input<string | null>(null);

  readonly addSubtopic = output<string>();
  readonly renameNode = output<{ nodeId: string; label: string }>();
  readonly requestDeleteTopic = output<string>();
  readonly requestDeleteSubtopic = output<{ topicId: string; subtopicId: string }>();
  readonly selectNode = output<string | null>();
  readonly moveTopic = output<{ topicId: string; toIndex: number }>();
  readonly moveSubtopic = output<{ topicId: string; subtopicId: string; toIndex: number }>();

  protected readonly menuOpen = signal(false);
  protected readonly menuX = signal(0);
  protected readonly menuY = signal(0);
  protected readonly menuTarget = signal<NodeMenuTarget | null>(null);
  protected readonly editingNodeId = signal<string | null>(null);
  protected readonly editingNodeLabel = signal('');
  private readonly canvasRootRef = viewChild<ElementRef<HTMLElement>>('canvasRoot');

  onTopicDrop(event: CdkDragDrop<TreeTopic[]>): void {
    if (event.previousIndex === event.currentIndex) {
      return;
    }

    const movedTopic = event.container.data[event.previousIndex];
    if (!movedTopic) {
      return;
    }

    this.moveTopic.emit({ topicId: movedTopic.id, toIndex: event.currentIndex });
  }

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
  }

  openSubtopicMenu(event: MouseEvent, topicId: string, subtopicId: string): void {
    event.preventDefault();
    this.menuTarget.set({ kind: 'subtopic', topicId, subtopicId });
    this.menuX.set(event.clientX);
    this.menuY.set(event.clientY);
    this.menuOpen.set(true);
  }

  closeNodeMenu(): void {
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

  onSubtopicMenuAction(action: 'focusRow' | 'deleteSubtopic'): void {
    const target = this.menuTarget();
    if (target?.kind !== 'subtopic') {
      this.closeNodeMenu();
      return;
    }

    if (action === 'focusRow') {
      this.selectNode.emit(target.subtopicId);
    } else {
      this.requestDeleteSubtopic.emit({
        topicId: target.topicId,
        subtopicId: target.subtopicId,
      });
    }

    this.closeNodeMenu();
  }

  protected onNodeFocus(nodeId: string, label: string): void {
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

  private commitNodeRename(nodeId: string, originalLabel: string): void {
    const nextLabel = this.editingNodeLabel();
    if (nextLabel !== originalLabel) {
      this.renameNode.emit({ nodeId, label: nextLabel });
    }
    this.editingNodeId.set(null);
    this.editingNodeLabel.set('');
  }

  protected onDocumentMouseDown(event: MouseEvent): void {
    const root = this.canvasRootRef()?.nativeElement;
    const target = event.target as Node | null;
    if (!root || !target || root.contains(target)) {
      return;
    }
    this.selectNode.emit(null);
  }

  private clearSelectionIfFocusLeftCanvas(event: FocusEvent): void {
    const root = this.canvasRootRef()?.nativeElement;
    const relatedTarget = event.relatedTarget as Node | null;
    if (!root || (relatedTarget && root.contains(relatedTarget))) {
      return;
    }
    this.selectNode.emit(null);
  }
}
