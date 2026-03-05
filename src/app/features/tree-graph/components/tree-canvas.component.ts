import { CdkDragDrop, CdkDragEnd, CdkDragStart, DragDropModule } from '@angular/cdk/drag-drop';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TreeNode, TreeTopic } from '../models/tree-table.model';
import { collectLeaves, computeLeafCounts } from '../utils/tree-helpers';
import { acquireMenuScrollLock, releaseMenuScrollLock } from '../utils/menu-scroll-lock';

interface TopicMenuTarget {
  kind: 'topic';
  topicId: string;
}

interface NodeMenuTarget {
  kind: 'node';
  topicId: string;
  nodeId: string;
}

type MenuTarget = TopicMenuTarget | NodeMenuTarget;

@Component({
  selector: 'app-tree-canvas',
  imports: [CommonModule, DragDropModule, FormsModule],
  host: {
    '(window:resize)': 'onWindowResize()',
    '(document:keydown.escape)': 'closeNodeMenu()',
    '(document:mousedown)': 'onDocumentMouseDown($event)',
    '(document:contextmenu)': 'onDocumentContextMenu($event)',
    '(document:tree-graph-menu-opened)': 'onGlobalMenuOpened($event)',
  },
  template: `
    <section #canvasRoot class="h-full py-1" aria-label="Tree graph canvas">
      <article class="space-y-3">
        <div class="relative flex items-center gap-2">
          <div
            #topicCard
            class="relative z-10 mx-1 inline-flex rounded-full border border-sky-300 bg-sky-100"
            [style.border-width]="'var(--tree-node-border-width)'"
            [class.ring-2]="selectedNodeId() === topic().id"
            [class.ring-sky-400]="selectedNodeId() === topic().id"
            (contextmenu)="openTopicMenu($event, topic().id)"
          >
            <input
              [ngModel]="nodeInputValue(topic().id, topic().label)"
              [attr.size]="nodeInputSize(topic().id, topic().label)"
              (focus)="onNodeFocus(topic().id, topic().label)"
              (ngModelChange)="onNodeModelChange(topic().id, $event)"
              (blur)="onNodeBlur($event, topic().id, topic().label)"
              (keydown.enter)="onNodeEnter($event, topic().id, topic().label)"
              (keydown.escape)="onNodeEscape($event, topic().id, topic().label)"
              class="block min-h-(--subtopic-node-height) min-w-36 w-auto rounded-full border-0 bg-transparent px-4 py-2 text-center text-sm font-semibold text-slate-800 focus-visible:outline-none"
              [attr.aria-label]="'Topic label: ' + topic().label"
            />
          </div>
        </div>

        @if (topic().children.length > 0) {
          <div class="relative" [style.margin-left.px]="topicHalfWidthPx()" [style.margin-top]="'var(--tree-topic-branch-gap)'">
            <ng-container
              [ngTemplateOutlet]="nodeList"
              [ngTemplateOutletContext]="{ nodes: topic().children, parentNodeId: null, isRoot: true }"
            />
          </div>
        }
      </article>

      <ng-template #nodeList let-nodes="nodes" let-parentNodeId="parentNodeId" let-isRoot="isRoot">
        <div
          class="relative"
          cdkDropList
          cdkDropListOrientation="vertical"
          [cdkDropListData]="nodes"
          (cdkDropListDropped)="onNodeDrop(parentNodeId, $event)"
          [attr.aria-label]="listAriaLabel(parentNodeId)"
        >
          @if (showListSpine(nodes, isRoot)) {
            <div
              aria-hidden="true"
              class="pointer-events-none absolute left-0 z-0 w-px bg-slate-300"
              [style.top.px]="listSpineTop(nodes, isRoot)"
              [style.height.px]="listSpineHeight(nodes, isRoot)"
            ></div>
          }
          <div>
            @for (node of nodes; track node.id) {
              <div
                cdkDrag
                cdkDragPreviewClass="drag-preview-solid"
                [cdkDragData]="node"
                (cdkDragStarted)="onNodeDragStarted($event)"
                (cdkDragEnded)="onNodeDragEnded($event)"
                class="relative flex items-start"
                [style.height.px]="nodeGroupHeight(node.id)"
              >
                <div
                  class="relative flex items-center self-start"
                >
                  <div
                    aria-hidden="true"
                    data-testid="node-connector-left"
                    class="z-0 h-px bg-slate-300"
                    [style.width]="incomingConnectorWidth(parentNodeId)"
                  ></div>
                  <div
                    class="relative z-10 cursor-grab rounded-xl border border-amber-300 bg-amber-100"
                    [style.border-width]="'var(--tree-node-border-width)'"
                    [attr.data-node-id]="node.id"
                    [class.ring-2]="selectedNodeId() === node.id"
                    [class.ring-amber-400]="selectedNodeId() === node.id"
                    (contextmenu)="openNodeMenu($event, topic().id, node.id)"
                  >
                    <input
                      [ngModel]="nodeInputValue(node.id, node.label)"
                      [attr.size]="nodeInputSize(node.id, node.label)"
                      (focus)="onNodeFocus(node.id, node.label)"
                      (ngModelChange)="onNodeModelChange(node.id, $event)"
                      (blur)="onNodeBlur($event, node.id, node.label)"
                      (keydown.enter)="onNodeEnter($event, node.id, node.label)"
                      (keydown.escape)="onNodeEscape($event, node.id, node.label)"
                      class="block min-h-(--subtopic-node-height) min-w-36 w-auto rounded-xl border-0 bg-transparent px-4 py-2 text-center text-sm font-medium text-slate-800 focus-visible:outline-none"
                      [attr.aria-label]="'Node label: ' + node.label"
                    />
                  </div>
                  <div
                    aria-hidden="true"
                    data-testid="node-connector-right"
                    class="z-0 h-px bg-slate-300"
                    [style.width]="outgoingConnectorWidth(node)"
                  ></div>
                </div>

                @if (node.children.length > 0) {
                  <div class="self-stretch">
                    <ng-container
                      [ngTemplateOutlet]="nodeList"
                      [ngTemplateOutletContext]="{ nodes: node.children, parentNodeId: node.id, isRoot: false }"
                    />
                  </div>
                }
              </div>
            }
          </div>
        </div>
      </ng-template>

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
              (click)="onTopicMenuAction('addChild')"
              class="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              role="menuitem"
              type="button"
            >
              Add node
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

          @if (menuTarget()?.kind === 'node') {
            <button
              (click)="onNodeMenuAction('addSibling')"
              class="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              role="menuitem"
              type="button"
            >
              Add node below
            </button>
            <button
              (click)="onNodeMenuAction('addChild')"
              class="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              role="menuitem"
              type="button"
            >
              Add child node
            </button>
            <button
              (click)="onNodeMenuAction('deleteNode')"
              class="block w-full rounded px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
              role="menuitem"
              type="button"
            >
              Delete node
            </button>
          }
        </section>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreeCanvasComponent implements AfterViewInit, OnDestroy {
  readonly topic = input.required<TreeTopic>();
  readonly selectedNodeId = input<string | null>(null);

  readonly addChildNode = output<{ topicId: string; parentNodeId: string | null }>();
  readonly addSiblingNode = output<{ topicId: string; nodeId: string }>();
  readonly renameNode = output<{ nodeId: string; label: string }>();
  readonly requestDeleteTopic = output<string>();
  readonly requestDeleteNode = output<{ topicId: string; nodeId: string }>();
  readonly selectNode = output<string | null>();
  readonly moveNode = output<{ topicId: string; parentNodeId: string | null; nodeId: string; toIndex: number }>();

  protected readonly menuOpen = signal(false);
  protected readonly menuX = signal(0);
  protected readonly menuY = signal(0);
  protected readonly menuTarget = signal<MenuTarget | null>(null);
  protected readonly editingNodeId = signal<string | null>(null);
  protected readonly editingNodeLabel = signal('');
  protected readonly leafCounts = computed(() => computeLeafCounts(this.topic().children));
  protected readonly topicHalfWidthPx = signal(80);
  private readonly canvasRootRef = viewChild<ElementRef<HTMLElement>>('canvasRoot');
  private readonly topicCardRef = viewChild<ElementRef<HTMLElement>>('topicCard');
  private readonly nodeMenuRef = viewChild<ElementRef<HTMLElement>>('nodeMenu');
  private readonly rowHeightPx = signal(54);
  private readonly nodeHeightPx = signal(42);
  private readonly rootListTopGapPx = signal(12);
  private readonly levelGapPx = signal(28);
  private readonly leafConnectorWidths = signal<Record<string, number>>({});
  private isScrollLocked = false;
  private isDraggingNode = false;
  private suppressNodeFocusUntil = 0;
  private readonly menuOwnerId = `tree-canvas-${crypto.randomUUID()}`;
  private measureFrameId: number | null = null;

  constructor() {
    effect(() => {
      this.topic();
      this.editingNodeId();
      this.editingNodeLabel();
      this.scheduleConnectorMeasure();
    });
  }

  ngAfterViewInit(): void {
    this.scheduleConnectorMeasure();
  }

  ngOnDestroy(): void {
    if (this.measureFrameId === null) {
      return;
    }
    cancelAnimationFrame(this.measureFrameId);
    this.measureFrameId = null;
  }

  onNodeDrop(parentNodeId: string | null, event: CdkDragDrop<TreeNode[]>): void {
    if (event.previousIndex === event.currentIndex) {
      return;
    }

    const moved = event.container.data[event.previousIndex];
    if (!moved) {
      return;
    }

    this.moveNode.emit({
      topicId: this.topic().id,
      parentNodeId,
      nodeId: moved.id,
      toIndex: event.currentIndex,
    });
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

  openNodeMenu(event: MouseEvent, topicId: string, nodeId: string): void {
    event.preventDefault();
    this.menuTarget.set({ kind: 'node', topicId, nodeId });
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

  onTopicMenuAction(action: 'addChild' | 'deleteTopic'): void {
    const target = this.menuTarget();
    if (target?.kind !== 'topic') {
      this.closeNodeMenu();
      return;
    }

    if (action === 'addChild') {
      this.addChildNode.emit({ topicId: target.topicId, parentNodeId: null });
    } else {
      this.requestDeleteTopic.emit(target.topicId);
    }

    this.closeNodeMenu();
  }

  onNodeMenuAction(action: 'addSibling' | 'addChild' | 'deleteNode'): void {
    const target = this.menuTarget();
    if (target?.kind !== 'node') {
      this.closeNodeMenu();
      return;
    }

    if (action === 'addSibling') {
      this.addSiblingNode.emit({ topicId: target.topicId, nodeId: target.nodeId });
      this.closeNodeMenu();
      return;
    }

    if (action === 'addChild') {
      this.addChildNode.emit({ topicId: target.topicId, parentNodeId: target.nodeId });
      this.closeNodeMenu();
      return;
    }

    this.requestDeleteNode.emit({ topicId: target.topicId, nodeId: target.nodeId });
    this.closeNodeMenu();
  }

  protected onNodeFocus(nodeId: string, label: string): void {
    if (this.isDraggingNode || Date.now() < this.suppressNodeFocusUntil) {
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

  protected onNodeDragStarted(_event: CdkDragStart<TreeNode>): void {
    this.isDraggingNode = true;
    this.editingNodeId.set(null);
    this.editingNodeLabel.set('');
    const activeInput = document.activeElement as HTMLInputElement | null;
    if (activeInput?.tagName === 'INPUT') {
      activeInput.blur();
    }
  }

  protected onNodeDragEnded(_event: CdkDragEnd<TreeNode>): void {
    this.isDraggingNode = false;
    this.suppressNodeFocusUntil = Date.now() + 180;
  }

  protected nodeGroupHeight(nodeId: string): number {
    const leafCount = this.leafCounts().get(nodeId) ?? 1;
    return Math.max(1, leafCount) * this.rowHeightPx();
  }

  protected listAriaLabel(parentNodeId: string | null): string {
    if (!parentNodeId) {
      return `Nodes for ${this.topic().label}`;
    }
    return 'Child nodes';
  }

  protected nodeInputSize(nodeId: string, label: string): number {
    const rendered = this.nodeInputValue(nodeId, label);
    return Math.max(8, Math.min(64, rendered.length + 2));
  }

  protected showListSpine(nodes: TreeNode[], isRoot: boolean): boolean {
    if (nodes.length === 0) {
      return false;
    }

    if (isRoot) {
      return true;
    }

    return nodes.length > 1;
  }

  protected listSpineTop(nodes: TreeNode[], isRoot: boolean): number {
    if (nodes.length === 0) {
      return 0;
    }

    if (isRoot) {
      return -this.rootListTopGapPx();
    }

    return this.nodeHeightPx() / 2;
  }

  protected listSpineHeight(nodes: TreeNode[], isRoot: boolean): number {
    if (nodes.length === 0) {
      return 0;
    }

    const top = this.listSpineTop(nodes, isRoot);
    const lastCenter = this.nodeCenterY(nodes, nodes.length - 1);
    return Math.max(0, lastCenter - top);
  }

  protected incomingConnectorWidth(parentNodeId: string | null): string {
    const gap = this.levelGapPx();
    if (parentNodeId === null) {
      return `${gap}px`;
    }
    return `${gap / 2}px`;
  }

  protected outgoingConnectorWidth(node: TreeNode): string {
    const gap = this.levelGapPx();
    if (node.children.length > 0) {
      return `${gap / 2}px`;
    }

    const leafWidth = this.leafConnectorWidths()[node.id];
    return `${Math.max(gap, leafWidth ?? gap)}px`;
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

  protected onWindowResize(): void {
    this.scheduleConnectorMeasure();
  }

  private nodeCenterY(nodes: TreeNode[], nodeIndex: number): number {
    let offset = 0;
    for (let index = 0; index < nodeIndex; index += 1) {
      const current = nodes[index];
      if (!current) {
        continue;
      }
      offset += this.nodeGroupHeight(current.id);
    }
    return offset + this.nodeHeightPx() / 2;
  }

  private scheduleConnectorMeasure(): void {
    if (this.measureFrameId !== null) {
      cancelAnimationFrame(this.measureFrameId);
    }
    this.measureFrameId = requestAnimationFrame(() => {
      this.measureFrameId = null;
      this.measureConnectorLayout();
    });
  }

  private measureConnectorLayout(): void {
    const root = this.canvasRootRef()?.nativeElement;
    if (!root) {
      return;
    }

    const topicCard = this.topicCardRef()?.nativeElement;
    if (topicCard) {
      const topicWidth = topicCard.getBoundingClientRect().width;
      if (topicWidth > 0) {
        this.topicHalfWidthPx.set(topicWidth / 2);
      }
    }

    const computedStyles = getComputedStyle(root);
    const subtopicNodeHeight = this.readCssPxVar(computedStyles, '--subtopic-node-height', 40);
    const subtopicGap = this.readCssPxVar(computedStyles, '--subtopic-gap', 13);
    const nodeBorderWidth = this.readCssPxVar(computedStyles, '--tree-node-border-width', 1);
    const topicBranchGap = this.readCssPxVar(computedStyles, '--tree-topic-branch-gap', 12);
    const nodeCardHeight = subtopicNodeHeight + nodeBorderWidth * 2;
    this.nodeHeightPx.set(nodeCardHeight);
    this.rowHeightPx.set(subtopicNodeHeight + subtopicGap + 1);
    this.rootListTopGapPx.set(topicBranchGap);

    const parsedGap = Number.parseFloat(computedStyles.getPropertyValue('--tree-level-gap').trim());
    const gap = Number.isFinite(parsedGap) && parsedGap > 0 ? parsedGap : 28;
    this.levelGapPx.set(gap);

    const leafIds = new Set(collectLeaves(this.topic().children).map((leaf) => leaf.id));
    if (leafIds.size === 0) {
      this.leafConnectorWidths.set({});
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const nodeCards = Array.from(root.querySelectorAll<HTMLElement>('[data-node-id]'));
    const leafRightById: Record<string, number> = {};
    let anchorX = 0;

    for (const card of nodeCards) {
      const nodeId = card.dataset['nodeId'];
      if (!nodeId || !leafIds.has(nodeId)) {
        continue;
      }

      const right = card.getBoundingClientRect().right - rootRect.left;
      leafRightById[nodeId] = right;
      if (right > anchorX) {
        anchorX = right;
      }
    }

    anchorX += gap;
    const nextWidths: Record<string, number> = {};
    for (const [nodeId, right] of Object.entries(leafRightById)) {
      nextWidths[nodeId] = Math.max(gap, anchorX - right);
    }
    this.leafConnectorWidths.set(nextWidths);
  }

  private readCssPxVar(styles: CSSStyleDeclaration, cssVariable: string, fallback: number): number {
    const raw = styles.getPropertyValue(cssVariable).trim();
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return fallback;
  }
}
