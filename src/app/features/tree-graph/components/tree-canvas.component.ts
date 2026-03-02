import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableColumn, TreeSubtopic, TreeTopic } from '../models/tree-table.model';
import { NodeRowCardComponent } from './node-row-card.component';

@Component({
  selector: 'app-tree-canvas',
  imports: [DragDropModule, FormsModule, NodeRowCardComponent],
  template: `
    <section
      class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm"
      aria-label="Tree graph canvas"
    >
      <div class="mb-3 grid grid-cols-[18rem_1fr] gap-4 px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <div>Tree Graph</div>
        <div>Attached Row Cards</div>
      </div>

      <div
        cdkDropList
        [cdkDropListData]="topics()"
        (cdkDropListDropped)="onTopicDrop($event)"
        class="space-y-4"
      >
        @for (topic of topics(); track topic.id; let topicIndex = $index) {
          <article cdkDrag [cdkDragData]="topic" class="space-y-3">
            <div class="grid grid-cols-[18rem_1fr] items-start gap-4">
              <div class="relative flex items-center gap-2">
                <button
                  class="drag-handle cursor-grab rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600"
                  cdkDragHandle
                  aria-label="Drag topic"
                  type="button"
                >
                  ↕
                </button>

                <div
                  class="relative min-w-0 flex-1 rounded-full border border-sky-300 bg-sky-100 px-3 py-2"
                  [class.ring-2]="selectedNodeId() === topic.id"
                  [class.ring-sky-400]="selectedNodeId() === topic.id"
                >
                  <div class="flex items-center gap-2">
                    <button
                      (click)="toggleExpand.emit(topic.id)"
                      class="rounded border border-sky-300 bg-white px-1.5 py-0.5 text-xs"
                      [attr.aria-expanded]="topic.expanded"
                      [attr.aria-label]="topic.expanded ? 'Collapse topic' : 'Expand topic'"
                      type="button"
                    >
                      {{ topic.expanded ? '−' : '+' }}
                    </button>
                    <input
                      [ngModel]="topic.label"
                      (focus)="selectNode.emit(topic.id)"
                      (ngModelChange)="renameNode.emit({ nodeId: topic.id, label: $event })"
                      class="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-slate-800 focus-visible:outline-none"
                      [attr.aria-label]="'Topic label: ' + topic.label"
                    />
                  </div>
                  <div class="pointer-events-none absolute -right-4 top-1/2 h-px w-4 -translate-y-1/2 bg-slate-400"></div>
                </div>

                <div class="flex flex-col gap-1">
                  <button
                    (click)="addSubtopic.emit(topic.id)"
                    class="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
                    type="button"
                  >
                    + child
                  </button>
                  <button
                    (click)="requestDeleteTopic.emit(topic.id)"
                    class="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700"
                    type="button"
                  >
                    Delete
                  </button>
                  <div class="flex gap-1">
                    <button
                      (click)="moveTopic.emit({ topicId: topic.id, toIndex: topicIndex - 1 })"
                      class="rounded border border-slate-300 px-2 py-1 text-xs"
                      [disabled]="topicIndex === 0"
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      (click)="moveTopic.emit({ topicId: topic.id, toIndex: topicIndex + 1 })"
                      class="rounded border border-slate-300 px-2 py-1 text-xs"
                      [disabled]="topicIndex === topics().length - 1"
                      type="button"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              </div>

              <app-node-row-card
                [nodeId]="topic.id"
                [label]="topic.label"
                kind="topic"
                [selected]="selectedNodeId() === topic.id"
                [columns]="columns()"
                [cells]="topic.cells"
                (setCell)="setCell.emit($event)"
              />
            </div>

            @if (topic.expanded) {
              <div
                cdkDropList
                [cdkDropListData]="topic.children"
                (cdkDropListDropped)="onSubtopicDrop(topic.id, $event)"
                class="space-y-3 pl-10"
                [attr.aria-label]="'Subtopics for ' + topic.label"
              >
                @for (subtopic of topic.children; track subtopic.id; let childIndex = $index) {
                  <div cdkDrag [cdkDragData]="subtopic" class="grid grid-cols-[18rem_1fr] items-start gap-4">
                    <div class="relative flex items-center gap-2">
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
                        class="relative min-w-0 flex-1 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2"
                        [class.ring-2]="selectedNodeId() === subtopic.id"
                        [class.ring-amber-400]="selectedNodeId() === subtopic.id"
                      >
                        <input
                          [ngModel]="subtopic.label"
                          (focus)="selectNode.emit(subtopic.id)"
                          (ngModelChange)="renameNode.emit({ nodeId: subtopic.id, label: $event })"
                          class="w-full border-0 bg-transparent text-sm font-medium text-slate-800 focus-visible:outline-none"
                          [attr.aria-label]="'Subtopic label: ' + subtopic.label"
                        />
                        <div class="pointer-events-none absolute -right-4 top-1/2 h-px w-4 -translate-y-1/2 bg-slate-400"></div>
                      </div>

                      <div class="flex flex-col gap-1">
                        <button
                          (click)="requestDeleteSubtopic.emit({ topicId: topic.id, subtopicId: subtopic.id })"
                          class="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700"
                          type="button"
                        >
                          Delete
                        </button>
                        <div class="flex gap-1">
                          <button
                            (click)="moveSubtopic.emit({ topicId: topic.id, subtopicId: subtopic.id, toIndex: childIndex - 1 })"
                            class="rounded border border-slate-300 px-2 py-1 text-xs"
                            [disabled]="childIndex === 0"
                            type="button"
                          >
                            ↑
                          </button>
                          <button
                            (click)="moveSubtopic.emit({ topicId: topic.id, subtopicId: subtopic.id, toIndex: childIndex + 1 })"
                            class="rounded border border-slate-300 px-2 py-1 text-xs"
                            [disabled]="childIndex === topic.children.length - 1"
                            type="button"
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    </div>

                    <app-node-row-card
                      [nodeId]="subtopic.id"
                      [label]="subtopic.label"
                      kind="subtopic"
                      [selected]="selectedNodeId() === subtopic.id"
                      [columns]="columns()"
                      [cells]="subtopic.cells"
                      (setCell)="setCell.emit($event)"
                    />
                  </div>
                }
              </div>
            }
          </article>
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreeCanvasComponent {
  readonly topics = input.required<TreeTopic[]>();
  readonly columns = input.required<TableColumn[]>();
  readonly selectedNodeId = input<string | null>(null);

  readonly addSubtopic = output<string>();
  readonly renameNode = output<{ nodeId: string; label: string }>();
  readonly toggleExpand = output<string>();
  readonly requestDeleteTopic = output<string>();
  readonly requestDeleteSubtopic = output<{ topicId: string; subtopicId: string }>();
  readonly setCell = output<{ nodeId: string; columnId: string; raw: string }>();
  readonly selectNode = output<string | null>();
  readonly moveTopic = output<{ topicId: string; toIndex: number }>();
  readonly moveSubtopic = output<{ topicId: string; subtopicId: string; toIndex: number }>();

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
}
