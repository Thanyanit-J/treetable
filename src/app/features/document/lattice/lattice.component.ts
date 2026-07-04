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
  LatticePill,
  LatticeRow,
  ROOT_PILL_ID,
  computeTopicLattice,
  hiddenLeavesOf,
} from '../../../core/lattice/lattice-layout';
import {
  ColumnV2,
  ConnectorStyle,
  NodeV2,
  TopicCardV2,
  collectLeaves,
  findNodeAndParent,
  moveNodeInTopic,
} from '../../../core/model/document.model';
import {
  DocumentStoreService,
  FormulaEditorSession,
} from '../../../core/store/document-store.service';
import { insertReferenceIntoInput } from '../formula-ref-insert';
import { NodePillComponent } from './node-pill.component';

interface ConnectorPath {
  id: string;
  d: string;
}

/**
 * The unified row lattice (ADR-0001): tree pills and table cells are cells of
 * ONE CSS grid, so a Leaf and its Row are the same grid row by construction.
 * All pixel geometry belongs to the browser; this component only assigns
 * integer grid coordinates, always measured in layout units so per-card zoom
 * cannot skew anything. Interaction follows the selection-first contract
 * (CONTEXT.md): one click selects, a second click edits.
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
            [style.grid-row]="1"
            [style.grid-column]="'1 / span ' + lattice().depthCount"
            [attr.aria-colspan]="lattice().depthCount"
          >
            <span class="sr-only">Hierarchy</span>
          </div>
          @for (column of renderColumns(); track column.id; let columnIndex = $index) {
            <div
              role="columnheader"
              class="group border-y border-r border-slate-200 p-0 align-top"
              [class.border-l]="columnIndex === 0"
              [class.bg-slate-100]="!isColumnSelected(column)"
              [class.bg-sky-100]="isColumnSelected(column)"
              [class.opacity-40]="draggingColumnId() === column.id"
              [class.formula-target]="isRefTarget(column)"
              [style.grid-row]="1"
              [style.grid-column]="dataGridColumn(columnIndex)"
              [attr.data-header-col]="column.id"
              [cdkContextMenuTriggerFor]="columnMenu"
              (contextmenu)="menuColumn.set(column); selectColumn(column)"
              (pointerenter)="onRefHover(column, true)"
              (pointerleave)="onRefHover(column, false)"
            >
              <div class="flex items-start">
                <div class="min-w-0 flex-1">
                  @if (isEditingHeader(column)) {
                    <input
                      class="edit-input w-full bg-transparent px-2 py-1.5 text-center text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                      [value]="column.displayName"
                      [attr.aria-label]="'Rename column ' + column.displayName"
                      (blur)="commitHeaderEdit(column, $event)"
                      (keydown.enter)="commitHeaderEditAndBlur(column, $event)"
                      (keydown.escape)="cancelEditing($event)"
                      (contextmenu)="$event.stopPropagation()"
                    />
                  } @else {
                    <div
                      tabindex="0"
                      class="w-full cursor-default touch-none px-2 py-1.5 text-center text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                      [class.font-mono]="formulaEditingActive()"
                      [attr.aria-label]="
                        'Column ' + column.displayName + ' (click again to rename, drag to reorder)'
                      "
                      (pointerdown)="onHeaderPointerDown(column, $event)"
                      (keydown.enter)="beginHeaderEdit(column, $event)"
                    >
                      {{ headerLabel(column) }}
                    </div>
                  }
                </div>
                <button
                  type="button"
                  class="mr-1 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 opacity-0 transition-opacity hover:bg-white/80 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-600 group-hover:opacity-100"
                  [cdkMenuTriggerFor]="columnMenu"
                  (click)="menuColumn.set(column); selectColumn(column)"
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
                class="z-10 flex px-2 py-1"
                [class.items-center]="pillAlignment() === 'center'"
                [class.items-start]="pillAlignment() === 'top'"
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
                  [selected]="isPillSelected(pill)"
                  [dropTarget]="dropPillId() === pill.nodeId"
                  (renamed)="renamePill(pill, $event)"
                  (selectedChange)="selectPill(pill)"
                  (toggleCollapse)="store.toggleCollapse(pill.nodeId)"
                  (addChild)="addChild(pill)"
                  (remove)="removePill(pill)"
                  (dragStarted)="startPillDrag(pill, $event)"
                  (duplicate)="duplicatePill(pill)"
                />
              </div>
            }
            @for (column of renderColumns(); track column.id; let columnIndex = $index) {
              <div
                role="gridcell"
                class="p-0"
                [class.border-b]="row.kind !== 'collapsed' || hasFooter()"
                [class.border-r]="row.kind !== 'collapsed' || hasFooter()"
                [class.border-slate-200]="row.kind !== 'collapsed' || hasFooter()"
                [class.border-l]="columnIndex === 0 && (row.kind !== 'collapsed' || hasFooter())"
                [class.bg-sky-50]="
                  selectedNodeId() === row.nodeId && !cellInRange(row.nodeId, column)
                "
                [class.bg-sky-100]="cellInRange(row.nodeId, column)"
                [class.opacity-40]="draggingColumnId() === column.id"
                [class.formula-target]="isRefTarget(column)"
                [style.grid-row]="rowIndex + 2"
                [style.grid-column]="dataGridColumn(columnIndex)"
                [attr.data-cell-node]="row.kind === 'leaf' ? row.nodeId : null"
                [attr.data-cell-col]="row.kind === 'leaf' ? column.id : null"
                [cdkContextMenuTriggerFor]="row.kind === 'leaf' ? cellMenu : null"
                (contextmenu)="onCellContextMenu(row, column)"
                (pointerenter)="onRefHover(column, true)"
                (pointerleave)="onRefHover(column, false)"
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
                } @else if (isEditingCell(row.nodeId, column)) {
                  <input
                    class="edit-input min-h-9 w-full min-w-24 max-w-72 field-sizing-content bg-white px-2 py-1.5 text-sm text-slate-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                    [class.text-right]="column.kind !== 'input' || column.valueType === 'number'"
                    [value]="cellEditValue(row.nodeId, column)"
                    [attr.aria-label]="cellAriaLabel(row.nodeId, column)"
                    (focus)="syncCellFormulaSession(column, $event)"
                    (input)="syncCellFormulaSession(column, $event)"
                    (blur)="commitCellEdit(row.nodeId, column, $event)"
                    (keydown.enter)="commitCellEditAndBlur(row.nodeId, column, $event)"
                    (keydown.escape)="cancelEditing($event)"
                    (contextmenu)="$event.stopPropagation()"
                  />
                } @else if (column.kind === 'chart') {
                  <div
                    tabindex="0"
                    class="flex min-h-9 w-44 items-center gap-1.5 px-2 py-1.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                    [class.cell-selected]="isCellSelected(row.nodeId, column)"
                    [attr.aria-label]="chartBarAria(row.nodeId, column)"
                    (pointerdown)="onCellPointerDown(row, column, $event)"
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
                  <div
                    tabindex="0"
                    class="min-h-9 w-full min-w-24 max-w-72 cursor-default truncate px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                    [class.text-right]="column.kind === 'computed' || column.valueType === 'number'"
                    [class.text-slate-700]="!cellHasError(row.nodeId, column)"
                    [class.text-rose-700]="cellHasError(row.nodeId, column)"
                    [class.bg-slate-50]="
                      column.kind === 'computed' && !cellInRange(row.nodeId, column)
                    "
                    [class.cell-selected]="isCellSelected(row.nodeId, column)"
                    [attr.aria-label]="cellAriaLabel(row.nodeId, column)"
                    [attr.title]="cellTitle(row.nodeId, column)"
                    (pointerdown)="onCellPointerDown(row, column, $event)"
                    (keydown.enter)="beginCellEditIfSelected(row.nodeId, column, $event)"
                  >
                    {{ cellDisplay(row.nodeId, column) }}
                  </div>
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
                  [selected]="isPillSelected(pill)"
                  (renamed)="store.renameCard(topic().id, $event)"
                  (selectedChange)="selectPill(pill)"
                  (addChild)="store.addChildNode(topic().id, null)"
                  (remove)="requestDeleteTopic.emit(topic().id)"
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
            @for (column of renderColumns(); track column.id; let columnIndex = $index) {
              <div
                role="gridcell"
                class="border-b border-r border-slate-200 bg-white"
                [class.border-l]="columnIndex === 0"
                [class.opacity-40]="draggingColumnId() === column.id"
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

    <ng-template #cellMenu>
      <div
        cdkMenu
        class="z-50 w-48 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-700 shadow-xl"
      >
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          [disabled]="!menuCellEditable()"
          (cdkMenuItemTriggered)="store.copySelection(true)"
        >
          Cut
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="store.copySelection()"
        >
          Copy
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          [disabled]="!canPasteCells()"
          (cdkMenuItemTriggered)="store.pasteSelection()"
        >
          Paste
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          [disabled]="!menuCellEditable()"
          (cdkMenuItemTriggered)="store.clearSelectedCells()"
        >
          Clear
        </button>
      </div>
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
    .menu-item:hover:not(:disabled),
    .menu-item:focus-visible {
      background: var(--color-slate-100);
      outline: none;
    }
    .menu-item:disabled {
      opacity: 0.4;
    }
    .cell-selected {
      outline: 2px solid var(--color-sky-500);
      outline-offset: -2px;
    }
    .formula-target {
      outline: 2px solid var(--color-violet-400);
      outline-offset: -2px;
      background: var(--color-violet-50);
    }
    .formula-target * {
      cursor: copy;
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
  readonly notify = output<string>();

  protected readonly selectedNodeId = this.store.selectedNodeId;

  /**
   * The Topic as currently rendered: the real one, or — while a drag is in
   * flight — a clone with the pending node move / column reorder applied.
   * This is what makes the drag preview *be* the drop result (the same
   * `moveNodeInTopic` runs on commit), while the store and its undo history
   * stay untouched until pointer-up.
   */
  protected readonly renderTopic = computed<TopicCardV2>(() => {
    const topic = this.topic();
    const dragging = this.draggingPill();
    const nodePreview = this.nodeDragPreview();
    const columnPreview = this.columnDragPreview();
    if ((!dragging || !nodePreview) && !columnPreview) {
      return topic;
    }
    const draft = structuredClone(topic);
    if (dragging && nodePreview) {
      moveNodeInTopic(draft, dragging.nodeId, nodePreview.parentId, nodePreview.index);
    }
    if (columnPreview) {
      const fromIndex = draft.columns.findIndex((column) => column.id === columnPreview.columnId);
      if (fromIndex >= 0) {
        const [column] = draft.columns.splice(fromIndex, 1);
        if (column) {
          draft.columns.splice(columnPreview.toIndex, 0, column);
        }
      }
    }
    return draft;
  });

  protected readonly renderColumns = computed(() => this.renderTopic().columns);

  protected readonly lattice = computed(() => {
    let collapsed = this.store.collapsedNodeIds();
    // Preview into a collapsed Branch shows it expanded — the drop expands it too.
    const previewParentId = this.nodeDragPreview()?.parentId;
    if (previewParentId && collapsed.has(previewParentId)) {
      const next = new Set(collapsed);
      next.delete(previewParentId);
      collapsed = next;
    }
    return computeTopicLattice(this.renderTopic(), collapsed);
  });
  protected readonly pillAlignment = computed(() => this.topic().pillAlignment ?? 'center');
  protected readonly connectorPaths = signal<ConnectorPath[]>([]);
  /** `header:<colId>` or `cell:<nodeId>:<colId>` — at most one editor at a time. */
  protected readonly editingKey = signal<string | null>(null);
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

    afterRenderEffect(() => {
      if (this.editingKey() !== null) {
        const input =
          this.latticeRootRef().nativeElement.querySelector<HTMLInputElement>('.edit-input');
        input?.focus();
        input?.select();
      }
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
  // Selection
  // -------------------------------------------------------------------------

  protected isPillSelected(pill: LatticePill): boolean {
    const selection = this.store.selection();
    if (!selection || selection.topicId !== this.topic().id) {
      return false;
    }
    if (pill.kind === 'root') {
      return selection.kind === 'card';
    }
    return selection.kind === 'node' && selection.nodeId === pill.nodeId;
  }

  protected isCellSelected(nodeId: string, column: ColumnV2): boolean {
    const selection = this.store.selection();
    return (
      selection?.kind === 'cell' &&
      selection.topicId === this.topic().id &&
      selection.nodeId === nodeId &&
      selection.columnId === column.id
    );
  }

  protected isColumnSelected(column: ColumnV2): boolean {
    const selection = this.store.selection();
    return (
      selection?.kind === 'column' &&
      selection.topicId === this.topic().id &&
      selection.columnId === column.id
    );
  }

  protected cellInRange(nodeId: string, column: ColumnV2): boolean {
    const selection = this.store.selection();
    if (selection?.kind !== 'range' || selection.topicId !== this.topic().id) {
      return false;
    }
    const rows = this.lattice().rows;
    const rowIndex = rows.findIndex((row) => row.nodeId === nodeId);
    const anchorRow = rows.findIndex((row) => row.nodeId === selection.anchor.nodeId);
    const focusRow = rows.findIndex((row) => row.nodeId === selection.focus.nodeId);
    const columns = this.topic().columns;
    const columnIndex = columns.findIndex((candidate) => candidate.id === column.id);
    const anchorColumn = columns.findIndex(
      (candidate) => candidate.id === selection.anchor.columnId,
    );
    const focusColumn = columns.findIndex((candidate) => candidate.id === selection.focus.columnId);
    if (
      [rowIndex, anchorRow, focusRow, columnIndex, anchorColumn, focusColumn].some((i) => i < 0)
    ) {
      return false;
    }
    return (
      rowIndex >= Math.min(anchorRow, focusRow) &&
      rowIndex <= Math.max(anchorRow, focusRow) &&
      columnIndex >= Math.min(anchorColumn, focusColumn) &&
      columnIndex <= Math.max(anchorColumn, focusColumn)
    );
  }

  protected selectPill(pill: LatticePill): void {
    const topicId = this.topic().id;
    this.store.select(
      pill.kind === 'root'
        ? { kind: 'card', topicId }
        : { kind: 'node', topicId, nodeId: pill.nodeId },
    );
  }

  protected selectColumn(column: ColumnV2): void {
    this.store.select({ kind: 'column', topicId: this.topic().id, columnId: column.id });
  }

  private selectCell(nodeId: string, column: ColumnV2): void {
    this.store.select({ kind: 'cell', topicId: this.topic().id, nodeId, columnId: column.id });
  }

  // -------------------------------------------------------------------------
  // Editing (click-again / Enter)
  // -------------------------------------------------------------------------

  protected isEditingHeader(column: ColumnV2): boolean {
    return this.editingKey() === `header:${column.id}`;
  }

  protected isEditingCell(nodeId: string, column: ColumnV2): boolean {
    return this.editingKey() === `cell:${nodeId}:${column.id}`;
  }

  protected beginHeaderEdit(column: ColumnV2, event?: Event): void {
    event?.preventDefault();
    this.editingKey.set(`header:${column.id}`);
  }

  protected beginCellEditIfSelected(nodeId: string, column: ColumnV2, event: Event): void {
    event.preventDefault();
    if (column.kind === 'chart') {
      return;
    }
    this.editingKey.set(`cell:${nodeId}:${column.id}`);
  }

  protected cancelEditing(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.editingKey.set(null);
    this.releaseCellFormulaSession();
    (event.target as HTMLElement | null)?.blur();
  }

  protected cellEditValue(nodeId: string, column: ColumnV2): string {
    if (column.kind === 'computed') {
      return column.expression ?? '=';
    }
    return this.inputCellRaw(nodeId, column);
  }

  protected commitCellEdit(nodeId: string, column: ColumnV2, event: Event): void {
    if (!this.isEditingCell(nodeId, column)) {
      return;
    }
    const value = (event.target as HTMLInputElement).value;
    this.editingKey.set(null);
    this.releaseCellFormulaSession();
    const previous = this.cellEditValue(nodeId, column);
    if (value === previous) {
      return;
    }
    if (column.kind === 'computed' && value.trim().length === 0) {
      return;
    }
    this.store.setCellValue(this.topic().id, nodeId, column.id, value);
  }

  protected commitCellEditAndBlur(nodeId: string, column: ColumnV2, event: Event): void {
    event.preventDefault();
    this.commitCellEdit(nodeId, column, event);
    (event.target as HTMLInputElement | null)?.blur();
  }

  protected commitHeaderEdit(column: ColumnV2, event: Event): void {
    if (!this.isEditingHeader(column)) {
      return;
    }
    const value = (event.target as HTMLInputElement).value;
    this.editingKey.set(null);
    if (value.trim().length > 0 && value !== column.displayName) {
      this.store.renameColumn(this.topic().id, column.id, value);
    }
  }

  protected commitHeaderEditAndBlur(column: ColumnV2, event: Event): void {
    event.preventDefault();
    this.commitHeaderEdit(column, event);
    (event.target as HTMLInputElement | null)?.blur();
  }

  // -------------------------------------------------------------------------
  // Cell pointer interaction: click select, click-again edit, drag = range
  // -------------------------------------------------------------------------

  protected onCellPointerDown(row: LatticeRow, column: ColumnV2, event: PointerEvent): void {
    if (event.button !== 0 || row.kind !== 'leaf') {
      return;
    }
    if (this.tryInsertRef(column, event)) {
      return;
    }
    event.preventDefault();
    const wasSelected = this.isCellSelected(row.nodeId, column);
    const cellElement = event.currentTarget as HTMLElement;
    cellElement.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    const onMove = (moveEvent: PointerEvent): void => {
      if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) {
        return;
      }
      dragging = true;
      const hit = this.cellUnderPointer(moveEvent);
      if (hit) {
        this.store.select({
          kind: 'range',
          topicId: this.topic().id,
          anchor: { nodeId: row.nodeId, columnId: column.id },
          focus: hit,
        });
      }
    };
    const onUp = (): void => {
      cleanup();
      if (dragging) {
        return;
      }
      if (wasSelected && column.kind !== 'chart') {
        this.editingKey.set(`cell:${row.nodeId}:${column.id}`);
      } else {
        this.selectCell(row.nodeId, column);
        cellElement.focus({ preventScroll: true });
      }
    };
    const cleanup = (): void => {
      cellElement.removeEventListener('pointermove', onMove);
      cellElement.removeEventListener('pointerup', onUp);
      cellElement.removeEventListener('pointercancel', cleanup);
    };
    cellElement.addEventListener('pointermove', onMove);
    cellElement.addEventListener('pointerup', onUp);
    cellElement.addEventListener('pointercancel', cleanup);
  }

  private cellUnderPointer(event: PointerEvent): { nodeId: string; columnId: string } | null {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const cell = element?.closest<HTMLElement>('[data-cell-node]');
    if (!cell || !this.latticeRootRef().nativeElement.contains(cell)) {
      return null;
    }
    const nodeId = cell.dataset['cellNode'];
    const columnId = cell.dataset['cellCol'];
    return nodeId && columnId ? { nodeId, columnId } : null;
  }

  protected onCellContextMenu(row: LatticeRow, column: ColumnV2): void {
    if (row.kind !== 'leaf') {
      return;
    }
    if (!this.isCellSelected(row.nodeId, column) && !this.cellInRange(row.nodeId, column)) {
      this.selectCell(row.nodeId, column);
    }
  }

  protected menuCellEditable(): boolean {
    const selection = this.store.selection();
    if (selection?.kind === 'cell') {
      const column = this.topic().columns.find((candidate) => candidate.id === selection.columnId);
      return column?.kind === 'input';
    }
    return selection?.kind === 'range';
  }

  protected canPasteCells(): boolean {
    return this.store.clipboard()?.kind === 'cells';
  }

  // -------------------------------------------------------------------------
  // Formula editing: while any formula editor is active (a `=` cell editor
  // here or the Inspector's formula field), headers show Reference Names,
  // hovering a column highlights it, and clicking a column inserts its
  // Reference Name at the editor's caret instead of moving the selection.
  // -------------------------------------------------------------------------

  protected readonly refHoverColumnId = signal<string | null>(null);
  private cellFormulaSession: FormulaEditorSession | null = null;

  protected formulaEditingActive(): boolean {
    return this.store.formulaEditor() !== null;
  }

  /** In a formula, columns go by Reference Name — so headers do too. */
  protected headerLabel(column: ColumnV2): string {
    return this.formulaEditingActive() ? column.refName : column.displayName;
  }

  protected canInsertRef(column: ColumnV2): boolean {
    const session = this.store.formulaEditor();
    if (!session || column.kind === 'chart') {
      return false;
    }
    // The edited column itself is not a target (self-reference).
    return !(session.topicId === this.topic().id && session.columnId === column.id);
  }

  protected isRefTarget(column: ColumnV2): boolean {
    return this.refHoverColumnId() === column.id && this.canInsertRef(column);
  }

  protected onRefHover(column: ColumnV2, entering: boolean): void {
    if (!entering) {
      if (this.refHoverColumnId() === column.id) {
        this.refHoverColumnId.set(null);
      }
      return;
    }
    this.refHoverColumnId.set(this.canInsertRef(column) ? column.id : null);
  }

  /**
   * Routes a column click into the active formula editor. `preventDefault`
   * on pointerdown keeps the editor focused — clicking never blurs it.
   * Foreign columns insert their Topic-qualified path (ADR-0003).
   */
  private tryInsertRef(column: ColumnV2, event: PointerEvent): boolean {
    const session = this.store.formulaEditor();
    if (!session || !this.canInsertRef(column)) {
      return false;
    }
    event.preventDefault();
    const refText =
      session.topicId === this.topic().id
        ? column.refName
        : `${this.topic().refName}.${column.refName}`;
    session.insertRef(refText);
    return true;
  }

  /** Registers/refreshes the cell editor as the formula editor while its value is a formula. */
  protected syncCellFormulaSession(column: ColumnV2, event: Event): void {
    const input = event.target as HTMLInputElement;
    const isFormula = column.kind === 'computed' || input.value.trimStart().startsWith('=');
    if (isFormula) {
      if (this.cellFormulaSession?.columnId !== column.id) {
        this.releaseCellFormulaSession();
        this.cellFormulaSession = {
          topicId: this.topic().id,
          columnId: column.id,
          insertRef: (refText) => insertReferenceIntoInput(input, refText),
        };
        this.store.setFormulaEditor(this.cellFormulaSession);
      }
    } else {
      this.releaseCellFormulaSession();
    }
  }

  private releaseCellFormulaSession(): void {
    if (this.cellFormulaSession) {
      this.store.clearFormulaEditor(this.cellFormulaSession);
      this.cellFormulaSession = null;
    }
  }

  // -------------------------------------------------------------------------
  // Pill actions
  // -------------------------------------------------------------------------

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

  protected removePill(pill: LatticePill): void {
    if (pill.kind === 'root') {
      this.requestDeleteTopic.emit(this.topic().id);
    } else {
      this.requestDeleteNode.emit({ topicId: this.topic().id, nodeId: pill.nodeId });
    }
  }

  protected duplicatePill(pill: LatticePill): void {
    if (pill.kind !== 'root') {
      this.store.duplicateNode(this.topic().id, pill.nodeId);
    }
  }

  // -------------------------------------------------------------------------
  // Drag: live preview. While the pointer moves, the pending move is applied
  // to a render-only clone (renderTopic), so the dragged node's rows and its
  // neighbors rearrange in real time; pointer-up commits exactly the
  // previewed move as ONE store call = one undo step. Hit-testing runs
  // against the previewed DOM each move, so the user aims at what they see.
  // Keyboard path: Move up / Move down in the Inspector.
  // -------------------------------------------------------------------------

  protected readonly draggingPill = signal<LatticePill | null>(null);
  protected readonly dropPillId = signal<string | null>(null);
  private readonly nodeDragPreview = signal<{ parentId: string | null; index: number } | null>(
    null,
  );

  private dragSession: {
    pill: LatticePill;
    parentId: string | null;
    fromIndex: number;
    /** Pills the node may be dropped onto (everything but itself + subtree). */
    targetIds: ReadonlySet<string>;
    /** Original siblings (minus the dragged node), in document order. */
    siblingIds: readonly string[];
    rootRect: DOMRect;
    zoomRatio: number;
    cleanup: () => void;
  } | null = null;

  protected startPillDrag(pill: LatticePill, event: PointerEvent): void {
    if (pill.kind === 'root' || event.button !== 0 || this.dragSession || this.columnDragSession) {
      return;
    }
    event.preventDefault();
    const root = this.latticeRootRef().nativeElement;
    // Capture on the lattice root: it survives the re-renders the live
    // preview causes, unlike the grip/label the gesture started on.
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released.
    }
    const rootRect = root.getBoundingClientRect();
    const zoomRatio = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1;

    const subtree = new Set<string>([pill.nodeId]);
    if (pill.node) {
      const collect = (children: readonly NodeV2[]): void => {
        for (const child of children) {
          subtree.add(child.id);
          collect(child.children);
        }
      };
      collect(pill.node.children);
    }
    const targetIds = new Set<string>();
    for (const candidate of this.lattice().pills) {
      if (!subtree.has(candidate.nodeId)) {
        targetIds.add(candidate.nodeId);
      }
    }

    const siblings = this.lattice()
      .pills.filter(
        (candidate) => candidate.kind !== 'root' && candidate.parentPillId === pill.parentPillId,
      )
      .sort((a, b) => a.rowStart - b.rowStart);
    const fromIndex = siblings.findIndex((candidate) => candidate.nodeId === pill.nodeId);
    const siblingIds = siblings
      .filter((candidate) => candidate.nodeId !== pill.nodeId)
      .map((candidate) => candidate.nodeId);

    const pointerId = event.pointerId;
    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId === pointerId) {
        this.updateNodeDrag(moveEvent);
      }
    };
    const onUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId === pointerId) {
        this.finishNodeDrag(true);
      }
    };
    const onCancel = (cancelEvent: PointerEvent): void => {
      if (cancelEvent.pointerId === pointerId) {
        this.finishNodeDrag(false);
      }
    };
    const onKeydown = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key === 'Escape') {
        this.finishNodeDrag(false);
      }
    };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKeydown);

    this.dragSession = {
      pill,
      parentId: pill.parentPillId === ROOT_PILL_ID ? null : pill.parentPillId,
      fromIndex,
      targetIds,
      siblingIds,
      rootRect,
      zoomRatio,
      cleanup: () => {
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerup', onUp);
        root.removeEventListener('pointercancel', onCancel);
        document.removeEventListener('keydown', onKeydown);
      },
    };
    this.draggingPill.set(pill);
  }

  private updateNodeDrag(event: PointerEvent): void {
    const session = this.dragSession;
    if (!session) {
      return;
    }
    const root = this.latticeRootRef().nativeElement;
    const x = (event.clientX - session.rootRect.left) / session.zoomRatio;
    const y = (event.clientY - session.rootRect.top) / session.zoomRatio;

    // Re-parent: pointer over another pill → preview as its last child.
    for (const element of root.querySelectorAll<HTMLElement>('[data-pill-id]')) {
      const id = element.dataset['pillId'];
      if (!id || !session.targetIds.has(id)) {
        continue;
      }
      const rect = layoutRectWithin(root, element);
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        this.applyNodePreview(
          { parentId: id === ROOT_PILL_ID ? null : id, index: Number.MAX_SAFE_INTEGER },
          id,
        );
        return;
      }
    }

    // Reorder: insertion index among the original siblings, by midpoint rule
    // on their current (previewed) positions.
    let index = 0;
    for (const siblingId of session.siblingIds) {
      const element = root.querySelector<HTMLElement>(`[data-pill-id="${CSS.escape(siblingId)}"]`);
      if (!element) {
        continue;
      }
      const rect = layoutRectWithin(root, element);
      if (y > (rect.top + rect.bottom) / 2) {
        index += 1;
      }
    }
    if (index === session.fromIndex) {
      this.applyNodePreview(null, null);
    } else {
      this.applyNodePreview({ parentId: session.parentId, index }, null);
    }
  }

  private applyNodePreview(
    preview: { parentId: string | null; index: number } | null,
    dropPillId: string | null,
  ): void {
    if (this.dropPillId() !== dropPillId) {
      this.dropPillId.set(dropPillId);
    }
    const current = this.nodeDragPreview();
    const unchanged =
      current === preview ||
      (current !== null &&
        preview !== null &&
        current.parentId === preview.parentId &&
        current.index === preview.index);
    if (!unchanged) {
      this.nodeDragPreview.set(preview);
    }
  }

  private finishNodeDrag(apply: boolean): void {
    const session = this.dragSession;
    if (!session) {
      return;
    }
    session.cleanup();
    this.dragSession = null;

    const preview = this.nodeDragPreview();
    if (
      apply &&
      preview &&
      !this.isCurrentPosition(session.pill.nodeId, preview.parentId, preview.index)
    ) {
      // Committing before clearing the preview renders the same layout the
      // preview showed — the drop lands exactly as previewed, in one step.
      this.store.moveNode(this.topic().id, session.pill.nodeId, preview.parentId, preview.index);
      if (preview.parentId !== null) {
        this.store.expandNode(preview.parentId);
      }
    }
    this.draggingPill.set(null);
    this.dropPillId.set(null);
    this.nodeDragPreview.set(null);
  }

  /** A drop landing exactly where the node already is must not touch history. */
  private isCurrentPosition(nodeId: string, parentId: string | null, index: number): boolean {
    const topic = this.topic();
    const located = findNodeAndParent(topic.children, nodeId);
    if (!located) {
      return false;
    }
    if ((located.parent?.id ?? null) !== parentId) {
      return false;
    }
    const siblingsWithoutNode =
      (located.parent ? located.parent.children.length : topic.children.length) - 1;
    return Math.max(0, Math.min(index, siblingsWithoutNode)) === located.index;
  }

  // -------------------------------------------------------------------------
  // Column header drag: horizontal reorder with live preview (click still
  // selects/edits; while a formula editor is active, click inserts a ref)
  // -------------------------------------------------------------------------

  private readonly columnDragPreview = signal<{ columnId: string; toIndex: number } | null>(null);
  protected readonly draggingColumnId = signal<string | null>(null);

  private columnDragSession: {
    column: ColumnV2;
    fromIndex: number;
    /** The other columns' ids, in original order. */
    otherIds: readonly string[];
    rootRect: DOMRect;
    zoomRatio: number;
    cleanup: () => void;
  } | null = null;

  protected onHeaderPointerDown(column: ColumnV2, event: PointerEvent): void {
    if (event.button !== 0 || this.dragSession || this.columnDragSession) {
      return;
    }
    if (this.tryInsertRef(column, event)) {
      return;
    }
    event.preventDefault();
    const wasSelected = this.isColumnSelected(column);
    const headerElement = event.currentTarget as HTMLElement;
    try {
      headerElement.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released.
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const cleanup = (): void => {
      headerElement.removeEventListener('pointermove', onMove);
      headerElement.removeEventListener('pointerup', onUp);
      headerElement.removeEventListener('pointercancel', cleanup);
    };
    const onMove = (moveEvent: PointerEvent): void => {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) {
        return;
      }
      cleanup();
      this.startColumnDrag(column, moveEvent);
    };
    const onUp = (): void => {
      cleanup();
      if (wasSelected) {
        this.beginHeaderEdit(column);
      } else {
        this.selectColumn(column);
        headerElement.focus({ preventScroll: true });
      }
    };
    headerElement.addEventListener('pointermove', onMove);
    headerElement.addEventListener('pointerup', onUp);
    headerElement.addEventListener('pointercancel', cleanup);
  }

  private startColumnDrag(column: ColumnV2, event: PointerEvent): void {
    const root = this.latticeRootRef().nativeElement;
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released.
    }
    const rootRect = root.getBoundingClientRect();
    const zoomRatio = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1;
    const columns = this.topic().columns;

    const pointerId = event.pointerId;
    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId === pointerId) {
        this.updateColumnDrag(moveEvent);
      }
    };
    const onUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId === pointerId) {
        this.finishColumnDrag(true);
      }
    };
    const onCancel = (cancelEvent: PointerEvent): void => {
      if (cancelEvent.pointerId === pointerId) {
        this.finishColumnDrag(false);
      }
    };
    const onKeydown = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key === 'Escape') {
        this.finishColumnDrag(false);
      }
    };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKeydown);

    this.columnDragSession = {
      column,
      fromIndex: columns.findIndex((candidate) => candidate.id === column.id),
      otherIds: columns.filter((candidate) => candidate.id !== column.id).map((c) => c.id),
      rootRect,
      zoomRatio,
      cleanup: () => {
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerup', onUp);
        root.removeEventListener('pointercancel', onCancel);
        document.removeEventListener('keydown', onKeydown);
      },
    };
    this.draggingColumnId.set(column.id);
    this.updateColumnDrag(event);
  }

  private updateColumnDrag(event: PointerEvent): void {
    const session = this.columnDragSession;
    if (!session) {
      return;
    }
    const root = this.latticeRootRef().nativeElement;
    const x = (event.clientX - session.rootRect.left) / session.zoomRatio;

    // Insertion index among the other columns, by midpoint rule on their
    // current (previewed) header positions.
    let index = 0;
    for (const otherId of session.otherIds) {
      const element = root.querySelector<HTMLElement>(`[data-header-col="${CSS.escape(otherId)}"]`);
      if (!element) {
        continue;
      }
      const rect = layoutRectWithin(root, element);
      if (x > (rect.left + rect.right) / 2) {
        index += 1;
      }
    }

    const preview =
      index === session.fromIndex ? null : { columnId: session.column.id, toIndex: index };
    const current = this.columnDragPreview();
    const unchanged =
      current === preview ||
      (current !== null && preview !== null && current.toIndex === preview.toIndex);
    if (!unchanged) {
      this.columnDragPreview.set(preview);
    }
  }

  private finishColumnDrag(apply: boolean): void {
    const session = this.columnDragSession;
    if (!session) {
      return;
    }
    session.cleanup();
    this.columnDragSession = null;

    const preview = this.columnDragPreview();
    if (apply && preview) {
      this.store.moveColumn(this.topic().id, preview.columnId, preview.toIndex);
    }
    this.draggingColumnId.set(null);
    this.columnDragPreview.set(null);
  }

  // -------------------------------------------------------------------------
  // Cells: display values
  // -------------------------------------------------------------------------

  protected inputCellRaw(nodeId: string, column: ColumnV2): string {
    const node = this.findNode(nodeId);
    return node?.values[column.id] ?? '';
  }

  protected cellHasError(nodeId: string, column: ColumnV2): boolean {
    if (column.kind === 'computed') {
      return this.computedCellError(nodeId, column) !== null;
    }
    if (column.valueType !== 'number') {
      return false;
    }
    const raw = this.inputCellRaw(nodeId, column).trim();
    return raw.length > 0 && !Number.isFinite(Number(raw));
  }

  protected cellDisplay(nodeId: string, column: ColumnV2): string {
    if (column.kind === 'computed') {
      const cell = this.evaluation().computedCells.get(nodeId)?.get(column.id);
      if (!cell) {
        return '';
      }
      if (cell.error !== null) {
        return '#ERR';
      }
      return cell.value === null ? '' : formatNumericValue(cell.value);
    }
    return this.inputCellRaw(nodeId, column);
  }

  protected cellTitle(nodeId: string, column: ColumnV2): string | null {
    if (column.kind === 'computed') {
      return this.computedCellError(nodeId, column) ?? column.expression;
    }
    return null;
  }

  protected computedCellError(nodeId: string, column: ColumnV2): string | null {
    return this.evaluation().computedCells.get(nodeId)?.get(column.id)?.error ?? null;
  }

  protected cellAriaLabel(nodeId: string, column: ColumnV2): string {
    const node = this.findNode(nodeId);
    return `${column.displayName} for ${node?.displayName ?? 'row'}`;
  }

  // Chart Columns --------------------------------------------------------------

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

  protected insertColumn(column: ColumnV2, side: 'left' | 'right'): void {
    this.store.insertColumn(this.topic().id, column.id, side);
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
    const style = this.topic().connectorStyle ?? 'elbow';

    for (const pill of this.lattice().pills) {
      if (pill.kind === 'root') {
        continue;
      }
      const to = pillRects.get(pill.nodeId);
      const from = pillRects.get(pill.parentPillId);
      if (to && from) {
        paths.push({ id: `edge-${pill.nodeId}`, d: connectorPath(style, from, to) });
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
 * Parent→child connector path from the parent pill's right edge to the child
 * pill's left edge: right-angle elbow (horizontal → vertical → horizontal),
 * one straight segment, or a cubic curve.
 */
function connectorPath(
  style: ConnectorStyle,
  from: { right: number; centerY: number },
  to: { left: number; centerY: number },
): string {
  switch (style) {
    case 'straight':
      return `M ${from.right} ${from.centerY} L ${to.left} ${to.centerY}`;
    case 'curved': {
      const dx = Math.max(12, (to.left - from.right) / 2);
      return `M ${from.right} ${from.centerY} C ${from.right + dx} ${from.centerY}, ${to.left - dx} ${to.centerY}, ${to.left} ${to.centerY}`;
    }
    case 'elbow': {
      const midX = (from.right + to.left) / 2;
      return `M ${from.right} ${from.centerY} L ${midX} ${from.centerY} L ${midX} ${to.centerY} L ${to.left} ${to.centerY}`;
    }
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
