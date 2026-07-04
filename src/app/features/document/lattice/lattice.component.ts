import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  TopicEvaluation,
  formatNumericValue,
  leafNumericValue,
  rollupSum,
} from '../../../core/engine/formula-evaluator';
import {
  AccentColor,
  ColumnV2,
  NodeV2,
  TopicCardV2,
  collectLeaves,
  findNodeAndParent,
} from '../../../core/model/document.model';
import { DocumentStoreService, RefNameTarget } from '../../../core/store/document-store.service';
import { LatticePill, ROOT_PILL_ID, computeTopicLattice, hiddenLeavesOf } from './lattice-layout';
import { NodePillComponent } from './node-pill.component';

interface ConnectorPath {
  id: string;
  d: string;
}

/**
 * The unified row lattice (ADR-0001): tree pills and table cells are cells of
 * ONE CSS grid, so a Leaf and its Row are the same grid row by construction.
 * All pixel geometry belongs to the browser; this component only assigns
 * integer grid coordinates. The SVG connector overlay is decorative — if it
 * lags a frame, nothing can misalign.
 */
@Component({
  selector: 'app-lattice',
  imports: [CdkContextMenuTrigger, CdkMenu, CdkMenuItem, CdkMenuTrigger, NodePillComponent],
  template: `
    <div #latticeRoot class="relative w-max">
      <div
        role="treegrid"
        class="grid w-max"
        [style.grid-template-columns]="gridTemplateColumns()"
        [attr.aria-label]="topic().displayName + ' tree-table'"
        [attr.aria-colcount]="columnCount()"
        [attr.aria-rowcount]="rowCount()"
      >
        <!-- Header -->
        <div role="row" class="contents" aria-rowindex="1">
          <div
            role="columnheader"
            class="border-b border-slate-200"
            [style.grid-row]="1"
            [style.grid-column]="'1 / span ' + lattice().depthCount"
            [attr.aria-colspan]="lattice().depthCount"
          >
            <span class="sr-only">Hierarchy</span>
          </div>
          @for (column of topic().columns; track column.id; let columnIndex = $index) {
            <div
              role="columnheader"
              class="group border-y border-r border-slate-200 bg-slate-100 p-0 align-top"
              [class.border-l]="columnIndex === 0"
              [style.grid-row]="1"
              [style.grid-column]="dataGridColumn(columnIndex)"
              [cdkContextMenuTriggerFor]="columnMenu"
              (contextmenu)="menuColumn.set(column)"
            >
              <div class="flex items-start">
                <div class="min-w-0 flex-1">
                  <input
                    class="w-full bg-transparent px-2 pt-1.5 text-center text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                    [value]="column.displayName"
                    [attr.aria-label]="'Rename column ' + column.displayName"
                    (blur)="commitColumnRename(column, $event)"
                    (keydown.enter)="commitColumnRenameAndBlur(column, $event)"
                    (keydown.escape)="revertInput($event, column.displayName)"
                  />
                  <div class="px-2 pb-1 text-center font-mono text-[10px] text-slate-400">
                    {{ column.refName }}
                    @if (column.kind === 'computed') {
                      <span [attr.title]="column.expression"> · ƒ</span>
                    }
                    @if (column.kind === 'chart') {
                      <span [attr.title]="'Bar chart of ' + column.chartSource">
                        · ▮ {{ column.chartSource }}</span
                      >
                    }
                  </div>
                </div>
                <button
                  type="button"
                  class="mr-1 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 opacity-0 transition-opacity hover:bg-white/80 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-600 group-hover:opacity-100"
                  [cdkMenuTriggerFor]="columnMenu"
                  (click)="menuColumn.set(column)"
                  [attr.aria-label]="'Actions for column ' + column.displayName"
                >
                  <span aria-hidden="true" class="text-xs leading-none">⋯</span>
                </button>
              </div>
            </div>
          }
        </div>

        <!-- Data rows -->
        @for (row of lattice().rows; track row.nodeId; let rowIndex = $index) {
          <div role="row" class="contents" [attr.aria-rowindex]="rowIndex + 2">
            @for (pill of pillsStartingAt(rowIndex + 1); track pill.nodeId) {
              <div
                role="gridcell"
                class="z-10 flex items-center px-2 py-1"
                [class.pr-6]="pill.rowSpan === 1 && pill.kind !== 'root'"
                [class.opacity-40]="draggingPill()?.nodeId === pill.nodeId"
                [style.grid-row]="pillGridRow(pill)"
                [style.grid-column]="pill.depth + 1"
                [attr.aria-rowspan]="pill.rowSpan > 1 ? pill.rowSpan : null"
              >
                <app-node-pill
                  [pillId]="pill.nodeId"
                  [label]="pill.node?.displayName ?? topic().displayName"
                  [kind]="pill.kind"
                  [accent]="pill.node?.accent ?? null"
                  [selected]="selectedNodeId() === pill.nodeId"
                  [dropTarget]="dropPillId() === pill.nodeId"
                  [canMoveUp]="canMovePill(pill, -1)"
                  [canMoveDown]="canMovePill(pill, 1)"
                  (renamed)="renamePill(pill, $event)"
                  (selectedChange)="selectPill(pill)"
                  (toggleCollapse)="store.toggleCollapse(pill.nodeId)"
                  (addChild)="addChild(pill)"
                  (addSibling)="addSibling(pill)"
                  (remove)="removePill(pill)"
                  (setAccent)="setPillAccent(pill, $event)"
                  (editRefName)="editPillRefName(pill)"
                  (dragStarted)="startPillDrag(pill, $event)"
                  (moveUp)="movePill(pill, -1)"
                  (moveDown)="movePill(pill, 1)"
                />
              </div>
            }
            @for (column of topic().columns; track column.id; let columnIndex = $index) {
              <div
                role="gridcell"
                class="p-0"
                [class.border-b]="row.kind !== 'collapsed' || hasFooter()"
                [class.border-r]="row.kind !== 'collapsed' || hasFooter()"
                [class.border-slate-200]="row.kind !== 'collapsed' || hasFooter()"
                [class.border-l]="columnIndex === 0 && (row.kind !== 'collapsed' || hasFooter())"
                [class.bg-sky-50]="selectedNodeId() === row.nodeId"
                [style.grid-row]="rowIndex + 2"
                [style.grid-column]="dataGridColumn(columnIndex)"
              >
                @if (row.kind === 'collapsed' && !hasFooter()) {
                  <!-- No Rollup configured anywhere: a collapsed Branch shows no Row (CONTEXT.md). -->
                } @else if (row.kind === 'collapsed') {
                  <div
                    class="min-h-9 px-2 py-1.5 text-right text-sm italic text-slate-500"
                    [attr.title]="rollupTitle(column)"
                    [attr.aria-label]="rollupAriaLabel(row.nodeId, column)"
                  >
                    {{ collapsedRollupDisplay(row.nodeId, column) }}
                  </div>
                } @else if (column.kind === 'input') {
                  <input
                    class="min-h-9 w-full min-w-24 max-w-72 field-sizing-content bg-transparent px-2 py-1.5 text-sm text-slate-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                    [class.text-right]="column.valueType === 'number'"
                    [class.text-rose-700]="isInvalidNumber(row.nodeId, column)"
                    [value]="inputCellRaw(row.nodeId, column)"
                    [attr.aria-label]="cellAriaLabel(row.nodeId, column)"
                    (focus)="store.selectNode(row.nodeId)"
                    (blur)="commitCell(row.nodeId, column, $event)"
                    (keydown.enter)="commitCellAndBlur(row.nodeId, column, $event)"
                    (keydown.escape)="revertInput($event, inputCellRaw(row.nodeId, column))"
                  />
                } @else if (column.kind === 'chart') {
                  <div
                    class="flex min-h-9 w-44 items-center gap-1.5 px-2 py-1.5"
                    [attr.aria-label]="chartBarAria(row.nodeId, column)"
                  >
                    <div class="h-3 flex-1 overflow-hidden rounded-sm bg-slate-100">
                      <div
                        class="h-full rounded-sm"
                        [class.bg-sky-400]="!chartBarNegative(row.nodeId, column)"
                        [class.bg-rose-400]="chartBarNegative(row.nodeId, column)"
                        [style.width.%]="chartBarPercent(row.nodeId, column)"
                      ></div>
                    </div>
                    <span class="w-14 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
                      {{ chartBarLabel(row.nodeId, column) }}
                    </span>
                  </div>
                } @else {
                  <input
                    class="min-h-9 w-full min-w-24 max-w-72 field-sizing-content bg-transparent px-2 py-1.5 text-right text-sm"
                    [class.text-slate-700]="!computedCellError(row.nodeId, column)"
                    [class.text-rose-700]="!!computedCellError(row.nodeId, column)"
                    [class.bg-slate-50]="!isEditingExpression(row.nodeId, column)"
                    [readOnly]="!isEditingExpression(row.nodeId, column)"
                    [value]="computedCellDisplay(row.nodeId, column)"
                    [attr.aria-label]="cellAriaLabel(row.nodeId, column)"
                    [attr.aria-invalid]="computedCellError(row.nodeId, column) ? 'true' : null"
                    [attr.title]="computedCellError(row.nodeId, column) ?? column.expression"
                    (focus)="store.selectNode(row.nodeId)"
                    (dblclick)="startExpressionEdit(row.nodeId, column)"
                    (keydown.enter)="onComputedEnter(row.nodeId, column, $event)"
                    (keydown.escape)="cancelExpressionEdit($event, row.nodeId, column)"
                    (blur)="commitExpression(row.nodeId, column, $event)"
                  />
                }
              </div>
            }
          </div>
        }

        <!-- Empty topic -->
        @if (lattice().rows.length === 0) {
          <div role="row" class="contents" aria-rowindex="2">
            @for (pill of pillsStartingAt(1); track pill.nodeId) {
              <div
                role="gridcell"
                class="flex items-center px-2 py-1"
                [style.grid-row]="2"
                [style.grid-column]="1"
              >
                <app-node-pill
                  [pillId]="pill.nodeId"
                  [label]="topic().displayName"
                  [kind]="pill.kind"
                  [selected]="false"
                  (renamed)="store.renameCard(topic().id, $event)"
                  (addChild)="store.addChildNode(topic().id, null)"
                  (remove)="requestDeleteTopic.emit(topic().id)"
                  (editRefName)="editPillRefName(pill)"
                />
              </div>
            }
            <div
              role="gridcell"
              class="flex items-center rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500"
              [style.grid-row]="2"
              [style.grid-column]="emptyMessageGridColumn()"
            >
              No nodes yet — use the topic menu to add one.
            </div>
          </div>
        }

        <!-- Footer rollups -->
        @if (hasFooter()) {
          <div role="row" class="contents" [attr.aria-rowindex]="lattice().rows.length + 2">
            <div
              role="gridcell"
              class="flex items-center justify-end px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-400"
              [style.grid-row]="footerGridRow()"
              [style.grid-column]="'1 / span ' + lattice().depthCount"
            >
              Total
            </div>
            @for (column of topic().columns; track column.id; let columnIndex = $index) {
              <div
                role="gridcell"
                class="border-b border-r border-slate-200 bg-white"
                [class.border-l]="columnIndex === 0"
                [style.grid-row]="footerGridRow()"
                [style.grid-column]="dataGridColumn(columnIndex)"
              >
                @if (column.rollup !== 'none') {
                  <div
                    class="min-h-9 px-2 py-1.5 text-right text-sm font-semibold text-slate-700"
                    [attr.aria-label]="'Total of ' + column.displayName"
                  >
                    {{ footerRollupDisplay(column) }}
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>

      <svg class="pointer-events-none absolute inset-0 z-0 h-full w-full" aria-hidden="true">
        @for (path of connectorPaths(); track path.id) {
          <path [attr.d]="path.d" fill="none" stroke="var(--color-slate-300)" stroke-width="1.5" />
        }
      </svg>

      @if (dropLineTop() !== null) {
        <div
          aria-hidden="true"
          class="pointer-events-none absolute left-0 right-0 z-20 h-0.5 rounded bg-sky-500"
          [style.top.px]="dropLineTop()"
        ></div>
      }
    </div>

    <ng-template #columnMenu>
      @if (menuColumn(); as column) {
        <div
          cdkMenu
          class="z-50 w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-700 shadow-xl"
        >
          <button
            cdkMenuItem
            type="button"
            class="menu-item"
            (cdkMenuItemTriggered)="insertColumn(column, 'left')"
          >
            Insert column left
          </button>
          <button
            cdkMenuItem
            type="button"
            class="menu-item"
            (cdkMenuItemTriggered)="insertColumn(column, 'right')"
          >
            Insert column right
          </button>
          @if (column.kind !== 'chart') {
            <button
              cdkMenuItem
              type="button"
              class="menu-item"
              (cdkMenuItemTriggered)="toggleRollup(column)"
            >
              {{ column.rollup === 'sum' ? 'Remove sum rollup' : 'Sum rollup' }}
            </button>
          }
          <button cdkMenuItem type="button" class="menu-item" [cdkMenuTriggerFor]="chartSourceMenu">
            {{ column.kind === 'chart' ? 'Change chart source…' : 'Bar chart of…' }}
          </button>
          @if (column.kind === 'chart') {
            <button
              cdkMenuItem
              type="button"
              class="menu-item"
              (cdkMenuItemTriggered)="store.setColumnChart(topic().id, column.id, null)"
            >
              Remove chart
            </button>
          }
          <button
            cdkMenuItem
            type="button"
            class="menu-item"
            (cdkMenuItemTriggered)="editColumnRefName(column)"
          >
            Edit reference name…
          </button>
          <button
            cdkMenuItem
            type="button"
            class="menu-item text-rose-700"
            (cdkMenuItemTriggered)="deleteColumn(column)"
          >
            Delete column
          </button>
        </div>
      }
    </ng-template>

    <ng-template #chartSourceMenu>
      @if (menuColumn(); as column) {
        <div
          cdkMenu
          class="z-50 w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-700 shadow-xl"
        >
          @for (source of chartSourceOptions(column); track source.id) {
            <button
              cdkMenuItem
              type="button"
              class="menu-item"
              (cdkMenuItemTriggered)="store.setColumnChart(topic().id, column.id, source.refName)"
            >
              {{ source.displayName }}
              <span class="ml-1 font-mono text-[10px] text-slate-400">{{ source.refName }}</span>
            </button>
          } @empty {
            <div class="px-3 py-2 text-sm text-slate-400">No source columns available</div>
          }
        </div>
      }
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
export class LatticeComponent {
  protected readonly store = inject(DocumentStoreService);
  private readonly destroyRef = inject(DestroyRef);

  readonly topic = input.required<TopicCardV2>();
  readonly evaluation = input.required<TopicEvaluation>();

  readonly requestDeleteTopic = output<string>();
  readonly requestDeleteNode = output<{ topicId: string; nodeId: string }>();
  readonly requestEditRefName = output<RefNameTarget>();
  readonly notify = output<string>();

  protected readonly selectedNodeId = this.store.selectedNodeId;
  protected readonly lattice = computed(() =>
    computeTopicLattice(this.topic(), this.store.collapsedNodeIds()),
  );
  protected readonly connectorPaths = signal<ConnectorPath[]>([]);
  protected readonly editingExpressionKey = signal<string | null>(null);
  /** Column whose actions menu is open (set just before the CDK trigger fires). */
  protected readonly menuColumn = signal<ColumnV2 | null>(null);

  private readonly latticeRootRef = viewChild.required<ElementRef<HTMLElement>>('latticeRoot');
  private resizeObserver: ResizeObserver | null = null;
  private measureFrame: number | null = null;

  constructor() {
    afterRenderEffect(() => {
      this.lattice();
      this.topic();
      this.scheduleConnectorMeasure();
      this.observeResize();
    });

    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      if (this.measureFrame !== null) {
        cancelAnimationFrame(this.measureFrame);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Grid geometry (integers only)
  // -------------------------------------------------------------------------

  protected readonly gridTemplateColumns = computed(() => {
    const tree = `repeat(${this.lattice().depthCount}, max-content)`;
    const data = `repeat(${Math.max(1, this.topic().columns.length)}, minmax(6rem, max-content))`;
    return `${tree} ${data}`;
  });

  protected readonly columnCount = computed(
    () => this.lattice().depthCount + this.topic().columns.length,
  );
  protected readonly rowCount = computed(
    () => this.lattice().rows.length + 1 + (this.hasFooter() ? 1 : 0),
  );
  protected readonly hasFooter = computed(() =>
    this.topic().columns.some((column) => column.rollup !== 'none'),
  );

  protected pillsStartingAt(rowStart: number): LatticePill[] {
    return this.lattice().pillsByRowStart.get(rowStart) ?? [];
  }

  protected pillGridRow(pill: LatticePill): string {
    return `${pill.rowStart + 1} / span ${pill.rowSpan}`;
  }

  protected dataGridColumn(columnIndex: number): number {
    return this.lattice().depthCount + columnIndex + 1;
  }

  protected emptyMessageGridColumn(): string {
    return `2 / span ${Math.max(1, this.columnCount() - 1)}`;
  }

  protected footerGridRow(): number {
    return this.lattice().rows.length + 2;
  }

  // -------------------------------------------------------------------------
  // Pill actions
  // -------------------------------------------------------------------------

  protected selectPill(pill: LatticePill): void {
    this.store.selectNode(pill.kind === 'root' ? null : pill.nodeId);
  }

  protected renamePill(pill: LatticePill, displayName: string): void {
    if (pill.kind === 'root') {
      this.store.renameCard(this.topic().id, displayName);
    } else {
      this.store.renameNode(this.topic().id, pill.nodeId, displayName);
    }
  }

  protected addChild(pill: LatticePill): void {
    this.store.addChildNode(this.topic().id, pill.kind === 'root' ? null : pill.nodeId);
  }

  protected addSibling(pill: LatticePill): void {
    if (pill.kind !== 'root') {
      this.store.addSiblingNode(this.topic().id, pill.nodeId);
    }
  }

  protected removePill(pill: LatticePill): void {
    if (pill.kind === 'root') {
      this.requestDeleteTopic.emit(this.topic().id);
    } else {
      this.requestDeleteNode.emit({ topicId: this.topic().id, nodeId: pill.nodeId });
    }
  }

  protected setPillAccent(pill: LatticePill, accent: AccentColor | null): void {
    if (pill.kind !== 'root') {
      this.store.setNodeAccent(this.topic().id, pill.nodeId, accent);
    }
  }

  protected editPillRefName(pill: LatticePill): void {
    const topicId = this.topic().id;
    this.requestEditRefName.emit(
      pill.kind === 'root'
        ? { kind: 'topic', topicId, entityId: topicId }
        : { kind: 'node', topicId, entityId: pill.nodeId },
    );
  }

  // -------------------------------------------------------------------------
  // Drag: reorder among siblings (drop between rows) or re-parent (drop on a
  // pill). Keyboard path: Move up / Move down in the pill menu.
  // -------------------------------------------------------------------------

  protected readonly draggingPill = signal<LatticePill | null>(null);
  protected readonly dropPillId = signal<string | null>(null);
  protected readonly dropLineTop = signal<number | null>(null);

  private dragSession: {
    pill: LatticePill;
    parentId: string | null;
    fromIndex: number;
    descendants: ReadonlySet<string>;
    pillRects: { pill: LatticePill; left: number; top: number; right: number; bottom: number }[];
    siblingBands: { top: number; bottom: number }[];
    pendingParentId: string | null;
    pendingIndex: number | null;
    cleanup: () => void;
  } | null = null;

  protected siblingPillsOf(pill: LatticePill): LatticePill[] {
    return this.lattice()
      .pills.filter(
        (candidate) => candidate.kind !== 'root' && candidate.parentPillId === pill.parentPillId,
      )
      .sort((a, b) => a.rowStart - b.rowStart);
  }

  protected canMovePill(pill: LatticePill, delta: number): boolean {
    if (pill.kind === 'root') {
      return false;
    }
    const siblings = this.siblingPillsOf(pill);
    const index = siblings.findIndex((candidate) => candidate.nodeId === pill.nodeId);
    const next = index + delta;
    return index >= 0 && next >= 0 && next < siblings.length;
  }

  protected movePill(pill: LatticePill, delta: number): void {
    if (!this.canMovePill(pill, delta)) {
      return;
    }
    const siblings = this.siblingPillsOf(pill);
    const index = siblings.findIndex((candidate) => candidate.nodeId === pill.nodeId);
    this.store.moveNode(this.topic().id, pill.nodeId, this.parentIdOf(pill), index + delta);
  }

  protected startPillDrag(pill: LatticePill, event: PointerEvent): void {
    if (pill.kind === 'root' || event.button !== 0 || this.dragSession) {
      return;
    }
    event.preventDefault();
    const grip = event.target as HTMLElement;
    grip.setPointerCapture(event.pointerId);

    const root = this.latticeRootRef().nativeElement;
    const rootRect = root.getBoundingClientRect();
    // Visual px → layout px conversion; self-calibrating against any ancestor
    // CSS zoom applied by the per-card viewport.
    const zoomRatio = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1;

    const descendants = new Set<string>();
    if (pill.node) {
      const collect = (children: readonly NodeV2[]): void => {
        for (const child of children) {
          descendants.add(child.id);
          collect(child.children);
        }
      };
      collect(pill.node.children);
    }

    const pillRects: {
      pill: LatticePill;
      left: number;
      top: number;
      right: number;
      bottom: number;
    }[] = [];
    for (const candidate of this.lattice().pills) {
      const element = root.querySelector<HTMLElement>(
        `[data-pill-id="${CSS.escape(candidate.nodeId)}"]`,
      );
      if (!element) {
        continue;
      }
      const rect = layoutRectWithin(root, element);
      pillRects.push({
        pill: candidate,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      });
    }

    const siblings = this.siblingPillsOf(pill);
    const fromIndex = siblings.findIndex((candidate) => candidate.nodeId === pill.nodeId);
    const siblingBands = siblings.map((sibling) => {
      const rect = pillRects.find((candidate) => candidate.pill.nodeId === sibling.nodeId);
      return { top: rect?.top ?? 0, bottom: rect?.bottom ?? 0 };
    });

    const onMove = (moveEvent: PointerEvent): void =>
      this.updateDrag(moveEvent, rootRect, zoomRatio);
    const onUp = (): void => this.finishDrag(true);
    const onCancel = (): void => this.finishDrag(false);
    const onKeydown = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key === 'Escape') {
        this.finishDrag(false);
      }
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKeydown);

    this.dragSession = {
      pill,
      parentId: this.parentIdOf(pill),
      fromIndex,
      descendants,
      pillRects,
      siblingBands,
      pendingParentId: null,
      pendingIndex: null,
      cleanup: () => {
        grip.removeEventListener('pointermove', onMove);
        grip.removeEventListener('pointerup', onUp);
        grip.removeEventListener('pointercancel', onCancel);
        document.removeEventListener('keydown', onKeydown);
      },
    };
    this.draggingPill.set(pill);
  }

  private updateDrag(event: PointerEvent, rootRect: DOMRect, zoomRatio: number): void {
    const session = this.dragSession;
    if (!session) {
      return;
    }
    const x = (event.clientX - rootRect.left) / zoomRatio;
    const y = (event.clientY - rootRect.top) / zoomRatio;

    // Re-parent: hovering another pill (never self, a descendant, or the current parent-as-noop).
    const hit = session.pillRects.find(
      (candidate) =>
        candidate.pill.nodeId !== session.pill.nodeId &&
        !session.descendants.has(candidate.pill.nodeId) &&
        x >= candidate.left &&
        x <= candidate.right &&
        y >= candidate.top &&
        y <= candidate.bottom,
    );
    if (hit) {
      this.dropPillId.set(hit.pill.nodeId);
      this.dropLineTop.set(null);
      session.pendingParentId = hit.pill.nodeId === ROOT_PILL_ID ? null : hit.pill.nodeId;
      session.pendingIndex = Number.MAX_SAFE_INTEGER;
      return;
    }

    // Reorder among current siblings: insertion point from pointer Y.
    let rawIndex = 0;
    for (const band of session.siblingBands) {
      if (y > (band.top + band.bottom) / 2) {
        rawIndex += 1;
      }
    }
    const adjustedIndex = rawIndex > session.fromIndex ? rawIndex - 1 : rawIndex;
    if (adjustedIndex === session.fromIndex) {
      this.clearDropIndicators();
      session.pendingParentId = null;
      session.pendingIndex = null;
      return;
    }

    const lineTop =
      rawIndex === 0
        ? (session.siblingBands[0]?.top ?? 0) - 3
        : (session.siblingBands[rawIndex - 1]?.bottom ?? 0) + 1;
    this.dropPillId.set(null);
    this.dropLineTop.set(lineTop);
    session.pendingParentId = session.parentId;
    session.pendingIndex = adjustedIndex;
  }

  private finishDrag(apply: boolean): void {
    const session = this.dragSession;
    if (!session) {
      return;
    }
    session.cleanup();
    this.dragSession = null;
    this.draggingPill.set(null);

    const dropPillId = this.dropPillId();
    this.clearDropIndicators();

    if (!apply || (session.pendingIndex === null && dropPillId === null)) {
      return;
    }

    if (dropPillId !== null) {
      const targetParentId = dropPillId === ROOT_PILL_ID ? null : dropPillId;
      this.store.moveNode(
        this.topic().id,
        session.pill.nodeId,
        targetParentId,
        Number.MAX_SAFE_INTEGER,
      );
      if (targetParentId) {
        this.store.expandNode(targetParentId);
      }
      return;
    }

    if (session.pendingIndex !== null) {
      this.store.moveNode(
        this.topic().id,
        session.pill.nodeId,
        session.pendingParentId,
        session.pendingIndex,
      );
    }
  }

  private clearDropIndicators(): void {
    this.dropPillId.set(null);
    this.dropLineTop.set(null);
  }

  private parentIdOf(pill: LatticePill): string | null {
    return pill.parentPillId === ROOT_PILL_ID ? null : pill.parentPillId;
  }

  protected editColumnRefName(column: ColumnV2): void {
    this.requestEditRefName.emit({ kind: 'column', topicId: this.topic().id, entityId: column.id });
  }

  // -------------------------------------------------------------------------
  // Cells
  // -------------------------------------------------------------------------

  protected inputCellRaw(nodeId: string, column: ColumnV2): string {
    const node = this.findNode(nodeId);
    return node?.values[column.id] ?? '';
  }

  protected isInvalidNumber(nodeId: string, column: ColumnV2): boolean {
    if (column.valueType !== 'number') {
      return false;
    }
    const raw = this.inputCellRaw(nodeId, column).trim();
    return raw.length > 0 && !Number.isFinite(Number(raw));
  }

  protected commitCell(nodeId: string, column: ColumnV2, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value !== this.inputCellRaw(nodeId, column)) {
      this.store.setCellValue(this.topic().id, nodeId, column.id, value);
    }
  }

  protected commitCellAndBlur(nodeId: string, column: ColumnV2, event: Event): void {
    event.preventDefault();
    this.commitCell(nodeId, column, event);
    (event.target as HTMLInputElement | null)?.blur();
  }

  protected revertInput(event: Event, original: string): void {
    event.preventDefault();
    event.stopPropagation();
    const input = event.target as HTMLInputElement | null;
    if (input) {
      input.value = original;
      input.blur();
    }
  }

  protected cellAriaLabel(nodeId: string, column: ColumnV2): string {
    const node = this.findNode(nodeId);
    return `${column.displayName} for ${node?.displayName ?? 'row'}`;
  }

  // Computed cells -----------------------------------------------------------

  protected computedCellError(nodeId: string, column: ColumnV2): string | null {
    return this.evaluation().computedCells.get(nodeId)?.get(column.id)?.error ?? null;
  }

  protected computedCellDisplay(nodeId: string, column: ColumnV2): string {
    if (this.isEditingExpression(nodeId, column)) {
      return column.expression ?? '=';
    }
    const cell = this.evaluation().computedCells.get(nodeId)?.get(column.id);
    if (!cell) {
      return '';
    }
    if (cell.error !== null) {
      return '#ERR';
    }
    return cell.value === null ? '' : formatNumericValue(cell.value);
  }

  protected isEditingExpression(nodeId: string, column: ColumnV2): boolean {
    return this.editingExpressionKey() === `${nodeId}::${column.id}`;
  }

  protected startExpressionEdit(nodeId: string, column: ColumnV2): void {
    this.editingExpressionKey.set(`${nodeId}::${column.id}`);
  }

  protected onComputedEnter(nodeId: string, column: ColumnV2, event: Event): void {
    event.preventDefault();
    if (this.isEditingExpression(nodeId, column)) {
      this.commitExpression(nodeId, column, event);
      (event.target as HTMLInputElement | null)?.blur();
    } else {
      this.startExpressionEdit(nodeId, column);
    }
  }

  protected cancelExpressionEdit(event: Event, nodeId: string, column: ColumnV2): void {
    if (!this.isEditingExpression(nodeId, column)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.editingExpressionKey.set(null);
    const input = event.target as HTMLInputElement | null;
    if (input) {
      input.value = this.computedCellDisplay(nodeId, column);
      input.blur();
    }
  }

  protected commitExpression(nodeId: string, column: ColumnV2, event: Event): void {
    if (!this.isEditingExpression(nodeId, column)) {
      return;
    }
    const value = (event.target as HTMLInputElement).value;
    this.editingExpressionKey.set(null);
    if (value.trim().length === 0 || value === column.expression) {
      return;
    }
    this.store.setCellValue(this.topic().id, nodeId, column.id, value);
  }

  // Chart Columns --------------------------------------------------------------

  protected chartSourceOptions(column: ColumnV2): ColumnV2[] {
    return this.topic().columns.filter(
      (candidate) => candidate.id !== column.id && candidate.kind !== 'chart',
    );
  }

  private chartSourceColumn(column: ColumnV2): ColumnV2 | null {
    return (
      this.topic().columns.find((candidate) => candidate.refName === column.chartSource) ?? null
    );
  }

  private chartValue(nodeId: string, column: ColumnV2): number | null {
    const source = this.chartSourceColumn(column);
    const leaf = this.findNode(nodeId);
    if (!source || !leaf) {
      return null;
    }
    return leafNumericValue(source, leaf, this.evaluation());
  }

  protected chartBarPercent(nodeId: string, column: ColumnV2): number {
    const source = this.chartSourceColumn(column);
    const value = this.chartValue(nodeId, column);
    if (!source || value === null) {
      return 0;
    }
    let max = 0;
    for (const leaf of collectLeaves(this.topic().children)) {
      const leafValue = leafNumericValue(source, leaf, this.evaluation());
      if (leafValue !== null) {
        max = Math.max(max, Math.abs(leafValue));
      }
    }
    if (max <= 0) {
      return 0;
    }
    return Math.min(100, (Math.abs(value) / max) * 100);
  }

  protected chartBarNegative(nodeId: string, column: ColumnV2): boolean {
    return (this.chartValue(nodeId, column) ?? 0) < 0;
  }

  protected chartBarLabel(nodeId: string, column: ColumnV2): string {
    const value = this.chartValue(nodeId, column);
    return value === null ? '—' : formatNumericValue(value);
  }

  protected chartBarAria(nodeId: string, column: ColumnV2): string {
    const node = this.findNode(nodeId);
    return `${column.displayName} bar for ${node?.displayName ?? 'row'}: ${this.chartBarLabel(nodeId, column)}`;
  }

  // Rollups -------------------------------------------------------------------

  protected collapsedRollupDisplay(nodeId: string, column: ColumnV2): string {
    if (column.rollup === 'none') {
      return '';
    }
    const node = this.findNode(nodeId);
    if (!node) {
      return '';
    }
    const total = rollupSum(column, hiddenLeavesOf(node), this.evaluation());
    return total === null ? '#ERR' : formatNumericValue(total);
  }

  protected rollupTitle(column: ColumnV2): string | null {
    return column.rollup === 'none' ? null : 'Rollup of hidden rows (read-only)';
  }

  protected rollupAriaLabel(nodeId: string, column: ColumnV2): string {
    const node = this.findNode(nodeId);
    return `Rollup of ${column.displayName} for collapsed ${node?.displayName ?? 'branch'}`;
  }

  protected footerRollupDisplay(column: ColumnV2): string {
    const total = rollupSum(column, collectLeaves(this.topic().children), this.evaluation());
    return total === null ? '#ERR' : formatNumericValue(total);
  }

  // Columns -------------------------------------------------------------------

  protected commitColumnRename(column: ColumnV2, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value.trim().length > 0 && value !== column.displayName) {
      this.store.renameColumn(this.topic().id, column.id, value);
    } else {
      (event.target as HTMLInputElement).value = column.displayName;
    }
  }

  protected commitColumnRenameAndBlur(column: ColumnV2, event: Event): void {
    event.preventDefault();
    this.commitColumnRename(column, event);
    (event.target as HTMLInputElement | null)?.blur();
  }

  protected insertColumn(column: ColumnV2, side: 'left' | 'right'): void {
    this.store.insertColumn(this.topic().id, column.id, side);
  }

  protected toggleRollup(column: ColumnV2): void {
    this.store.setColumnRollup(
      this.topic().id,
      column.id,
      column.rollup === 'sum' ? 'none' : 'sum',
    );
  }

  protected deleteColumn(column: ColumnV2): void {
    const result = this.store.deleteColumn(this.topic().id, column.id);
    if (result && !result.ok && result.error) {
      this.notify.emit(result.error);
    }
  }

  // -------------------------------------------------------------------------
  // Connector overlay (decorative; alignment never depends on it)
  // -------------------------------------------------------------------------

  private observeResize(): void {
    if (this.resizeObserver || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.scheduleConnectorMeasure());
    this.resizeObserver.observe(this.latticeRootRef().nativeElement);
  }

  private scheduleConnectorMeasure(): void {
    if (this.measureFrame !== null) {
      cancelAnimationFrame(this.measureFrame);
    }
    this.measureFrame = requestAnimationFrame(() => {
      this.measureFrame = null;
      this.measureConnectors();
    });
  }

  /**
   * All measurement uses layout coordinates (offsetLeft/offsetTop chains),
   * never getBoundingClientRect — so per-card zoom (CSS `zoom` on an
   * ancestor) cannot skew the overlay: layout units are zoom-independent.
   */
  private measureConnectors(): void {
    const root = this.latticeRootRef().nativeElement;
    const pillRects = new Map<string, { left: number; right: number; centerY: number }>();
    for (const element of root.querySelectorAll<HTMLElement>('[data-pill-id]')) {
      const id = element.dataset['pillId'];
      if (id) {
        pillRects.set(id, layoutRectWithin(root, element));
      }
    }

    const paths: ConnectorPath[] = [];
    const dataRegionLeft = this.measureDataRegionLeft(root);

    for (const pill of this.lattice().pills) {
      if (pill.kind === 'root') {
        continue;
      }
      const to = pillRects.get(pill.nodeId);
      const from = pillRects.get(pill.parentPillId);
      if (to && from) {
        const dx = Math.max(12, (to.left - from.right) / 2);
        paths.push({
          id: `edge-${pill.nodeId}`,
          d: `M ${from.right} ${from.centerY} C ${from.right + dx} ${from.centerY}, ${to.left - dx} ${to.centerY}, ${to.left} ${to.centerY}`,
        });
      }

      if ((pill.kind === 'leaf' || pill.kind === 'collapsed') && to && dataRegionLeft !== null) {
        if (dataRegionLeft > to.right) {
          paths.push({
            id: `row-${pill.nodeId}`,
            d: `M ${to.right} ${to.centerY} L ${dataRegionLeft} ${to.centerY}`,
          });
        }
      }
    }

    this.connectorPaths.set(paths);
  }

  private measureDataRegionLeft(root: HTMLElement): number | null {
    const firstHeader = root.querySelector<HTMLElement>('[role="columnheader"]:nth-of-type(2)');
    if (!firstHeader) {
      return null;
    }
    return layoutRectWithin(root, firstHeader).left;
  }

  // -------------------------------------------------------------------------

  private findNode(nodeId: string): NodeV2 | null {
    return findNodeAndParent(this.topic().children, nodeId)?.node ?? null;
  }
}

/**
 * Position and size of `element` relative to `root` in layout coordinates,
 * accumulated through the offsetParent chain. Unlike getBoundingClientRect,
 * these values are unaffected by ancestor CSS zoom/transform — which is what
 * keeps the SVG overlay and drag math correct inside a zoomed card.
 */
function layoutRectWithin(
  root: HTMLElement,
  element: HTMLElement,
): { left: number; top: number; right: number; bottom: number; centerY: number } {
  let left = 0;
  let top = 0;
  let current: HTMLElement | null = element;
  while (current && current !== root) {
    left += current.offsetLeft;
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return {
    left,
    top,
    right: left + element.offsetWidth,
    bottom: top + element.offsetHeight,
    centerY: top + element.offsetHeight / 2,
  };
}
