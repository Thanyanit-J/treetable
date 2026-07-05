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
  formatCellNumber,
  leafNumericValue,
  rollupValue,
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
  clampColumnWidth,
  clampRowHeight,
  collectLeaves,
  findNodeAndParent,
  moveNodeInTopic,
} from '../../../core/model/document.model';
import {
  DocumentStoreService,
  FormulaEditorSession,
} from '../../../core/store/document-store.service';
import { insertReferenceIntoInput } from '../formula-ref-insert';
import { FormulaSuggestService } from '../formula-suggest.service';
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
          @if (lattice().depthCount > 0) {
            <div
              role="columnheader"
              [style.grid-row]="1"
              [style.grid-column]="'1 / span ' + lattice().depthCount"
              [attr.aria-colspan]="lattice().depthCount"
            >
              <span class="sr-only">Hierarchy</span>
            </div>
          }
          @if (showRowNumbers()) {
            <div
              role="columnheader"
              class="border-y border-r border-slate-200 bg-slate-50 px-1.5 py-1.5 text-right text-xs font-medium text-slate-400"
              [class.border-l]="lattice().depthCount === 0"
              [style.grid-row]="1"
              [style.grid-column]="numberGridColumn()"
            >
              #
            </div>
          }
          @for (column of renderColumns(); track column.id; let columnIndex = $index) {
            <div
              role="columnheader"
              class="group relative border-y border-r border-slate-200 p-0 align-top"
              [class.border-l]="columnIndex === 0"
              [class.bg-slate-100]="!isColumnSelected(column) && !headerInRange(column)"
              [class.bg-sky-100]="isColumnSelected(column) || headerInRange(column)"
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
                      class="edit-input w-full field-sizing-content bg-transparent px-2 py-1.5 text-center text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
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
                        'Column ' +
                        column.displayName +
                        (column.kind === 'computed' ? ' (formula)' : '') +
                        ' (click again to rename, drag to reorder)'
                      "
                      (pointerdown)="onHeaderPointerDown(column, $event)"
                      (keydown.enter)="beginHeaderEdit(column, $event)"
                    >
                      @if (column.kind === 'computed') {
                        <!-- Formula marker: computed cells look like any other cell. -->
                        <span
                          aria-hidden="true"
                          class="mr-1 font-mono text-[11px] font-bold text-slate-400"
                          title="Formula column"
                          >=</span
                        >
                      }
                      {{ headerLabel(column) }}
                    </div>
                  }
                </div>
                <!-- Overlays the header text on hover so the title stays centered. -->
                <button
                  type="button"
                  class="pointer-events-none absolute right-1 top-1/2 z-10 flex h-5 w-5 shrink-0 -translate-y-1/2 items-center justify-center rounded bg-white/70 text-slate-500 opacity-0 transition-opacity hover:bg-white focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-600 group-hover:pointer-events-auto group-hover:opacity-100"
                  [cdkMenuTriggerFor]="columnMenu"
                  (click)="menuColumn.set(column); selectColumn(column)"
                  [attr.aria-label]="'Actions for column ' + column.displayName"
                >
                  <span aria-hidden="true" class="text-xs leading-none">⋯</span>
                </button>
              </div>
              <!-- Column width handle on the header's right edge. -->
              <button
                type="button"
                class="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none focus-visible:bg-sky-300/70 focus-visible:outline-none"
                [class.line-hot]="isBorderHot('column', column.id)"
                [attr.aria-label]="
                  'Resize column ' +
                  column.displayName +
                  ' (drag, or arrow keys; double-click fits content)'
                "
                (pointerenter)="onBorderHover('column', column.id, $event)"
                (pointerleave)="onBorderLeave()"
                (pointerdown)="startColumnResize(column, $event)"
                (dblclick)="store.setColumnWidth(topic().id, column.id, null)"
                (keydown.arrowleft)="nudgeColumnWidth(column, $event, -16)"
                (keydown.arrowright)="nudgeColumnWidth(column, $event, 16)"
                (click)="$event.stopPropagation()"
              ></button>
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
            @if (showRowNumbers()) {
              <div
                role="gridcell"
                aria-hidden="true"
                class="flex min-h-9 items-center justify-end border-b border-r border-slate-200 bg-slate-50 px-1.5 py-1.5 text-right text-xs tabular-nums text-slate-400"
                [class.border-l]="lattice().depthCount === 0"
                [style.grid-row]="rowIndex + 2"
                [style.grid-column]="numberGridColumn()"
              >
                {{ rowIndex + 1 }}
              </div>
            }
            @if (row.kind === 'collapsed' && !hasFooter()) {
              <!-- No Summary configured anywhere: one merged cell counts the hidden rows. -->
              <div
                role="gridcell"
                tabindex="0"
                class="flex h-full min-h-9 items-center border-b border-l border-r border-slate-200 px-2 py-1.5 text-xs italic text-slate-400 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                [class.bg-sky-50]="selectedNodeId() === row.nodeId"
                [style.min-height.px]="rowMinHeight(row)"
                [style.grid-row]="rowIndex + 2"
                [style.grid-column]="hiddenRowGridColumn()"
                [attr.aria-colspan]="renderColumns().length"
                [cdkContextMenuTriggerFor]="collapsedMenu"
                (contextmenu)="selectHiddenRow(row)"
                (pointerdown)="onHiddenRowPointerDown(row, $event)"
              >
                {{ hiddenRowLabel(row.nodeId) }}
              </div>
            } @else {
              @for (column of renderColumns(); track column.id; let columnIndex = $index) {
                <div
                  role="gridcell"
                  class="relative border-b border-r border-slate-200 p-0"
                  [class.overflow-hidden]="column.width !== undefined"
                  [style.min-height.px]="rowMinHeight(row)"
                  [class.border-l]="columnIndex === 0"
                  [class.bg-sky-50]="
                    (selectedNodeId() === row.nodeId || isColumnSelected(column)) &&
                    !cellInRange(row.nodeId, column)
                  "
                  [class.bg-sky-100]="cellInRange(row.nodeId, column)"
                  [class.opacity-40]="draggingColumnId() === column.id"
                  [class.formula-target]="isRefTarget(column)"
                  [style.grid-row]="rowIndex + 2"
                  [style.grid-column]="dataGridColumn(columnIndex)"
                  [attr.data-cell-node]="row.nodeId"
                  [attr.data-cell-col]="column.id"
                  [cdkContextMenuTriggerFor]="row.kind === 'leaf' ? cellMenu : collapsedMenu"
                  (contextmenu)="onCellContextMenu(row, column)"
                  (pointerenter)="onRefHover(column, true)"
                  (pointerleave)="onRefHover(column, false)"
                >
                  @if (row.kind === 'collapsed') {
                    <div
                      tabindex="0"
                      class="h-full min-h-9 px-2 py-1.5 text-right text-sm italic text-slate-500 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                      [class.cell-selected]="isCellSelected(row.nodeId, column)"
                      [attr.title]="rollupTitle(column)"
                      [attr.aria-label]="rollupAriaLabel(row.nodeId, column)"
                      (pointerdown)="onCellPointerDown(row, column, $event)"
                    >
                      {{ collapsedRollupDisplay(row.nodeId, column) }}
                    </div>
                  } @else if (isEditingCell(row.nodeId, column)) {
                    <input
                      class="edit-input h-full min-h-9 w-full min-w-24 max-w-72 field-sizing-content bg-white px-2 py-1.5 text-sm text-slate-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                      [class.text-right]="column.kind !== 'input' || column.valueType === 'number'"
                      [value]="cellEditValue(row.nodeId, column)"
                      [attr.aria-label]="cellAriaLabel(row.nodeId, column)"
                      (focus)="syncCellFormulaSession(column, $event)"
                      (input)="syncCellFormulaSession(column, $event)"
                      (keyup)="onEditorKeyup($event)"
                      (click)="suggest.refresh()"
                      (blur)="commitCellEdit(row.nodeId, column, $event)"
                      (keydown.enter)="onCellEditorEnter(row.nodeId, column, $event)"
                      (keydown.arrowdown)="onSuggestMove($event, 1)"
                      (keydown.arrowup)="onSuggestMove($event, -1)"
                      (keydown.control.i)="onSuggestToggle($event)"
                      (keydown.meta.i)="onSuggestToggle($event)"
                      (keydown.escape)="cancelEditing($event)"
                      (contextmenu)="$event.stopPropagation()"
                    />
                  } @else if (column.kind === 'chart') {
                    <div
                      tabindex="0"
                      class="flex h-full min-h-9 w-44 items-center gap-1.5 px-2 py-1.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
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
                      <span
                        class="w-14 shrink-0 text-right text-[10px] tabular-nums text-slate-400"
                      >
                        {{ chartBarLabel(row.nodeId, column) }}
                      </span>
                    </div>
                  } @else {
                    <div
                      tabindex="0"
                      class="h-full min-h-9 w-full min-w-24 cursor-default px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                      [class.truncate]="column.wrap !== true"
                      [class.max-w-72]="!column.width"
                      [class.break-words]="column.wrap === true"
                      [class.text-right]="
                        column.kind === 'computed' || column.valueType === 'number'
                      "
                      [class.text-slate-700]="!cellHasError(row.nodeId, column)"
                      [class.text-rose-700]="cellHasError(row.nodeId, column)"
                      [class.cell-selected]="isCellSelected(row.nodeId, column)"
                      [attr.aria-label]="cellAriaLabel(row.nodeId, column)"
                      [attr.title]="cellTitle(row.nodeId, column)"
                      (pointerdown)="onCellPointerDown(row, column, $event)"
                      (keydown.enter)="beginCellEditIfSelected(row.nodeId, column, $event)"
                    >
                      {{ cellDisplay(row.nodeId, column) }}
                    </div>
                  }
                  <!-- Border drags work along the whole line, not just the
                       header: every cell edge carries a handle (the header
                       keeps the keyboard-accessible one). -->
                  <button
                    type="button"
                    tabindex="-1"
                    aria-hidden="true"
                    class="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize touch-none"
                    [class.line-hot]="isBorderHot('column', column.id)"
                    (pointerenter)="onBorderHover('column', column.id, $event)"
                    (pointerleave)="onBorderLeave()"
                    (pointerdown)="startColumnResize(column, $event)"
                    (dblclick)="
                      $event.stopPropagation(); store.setColumnWidth(topic().id, column.id, null)
                    "
                  ></button>
                  <button
                    type="button"
                    tabindex="-1"
                    aria-hidden="true"
                    class="absolute inset-x-0 bottom-0 z-10 h-1 cursor-row-resize touch-none"
                    [class.line-hot]="isBorderHot('row', row.nodeId)"
                    (pointerenter)="onBorderHover('row', row.nodeId, $event)"
                    (pointerleave)="onBorderLeave()"
                    (pointerdown)="startRowResize(row, $event)"
                    (dblclick)="
                      $event.stopPropagation(); store.setRowHeight(topic().id, row.nodeId, null)
                    "
                  ></button>
                </div>
              }
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
            <!-- Pure tables (no tree columns) skip the caption — the boxed
                 totals row explains itself, and the number gutter is narrow. -->
            @if (lattice().depthCount > 0) {
              <div
                role="gridcell"
                class="flex items-center justify-end px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-400"
                [style.grid-row]="footerGridRow()"
                [style.grid-column]="'1 / span ' + (lattice().depthCount + numberOffset())"
              >
                Summary
              </div>
            }
            <!-- Only columns WITH a summary get a bordered footer cell; the
                 rest of the footer row stays blank. -->
            @for (column of renderColumns(); track column.id; let columnIndex = $index) {
              <div
                role="gridcell"
                class="border-slate-200"
                [class.border-b]="column.rollup !== 'none'"
                [class.border-r]="column.rollup !== 'none'"
                [class.bg-white]="column.rollup !== 'none'"
                [class.border-l]="column.rollup !== 'none' && footerNeedsLeftBorder(columnIndex)"
                [class.opacity-40]="draggingColumnId() === column.id"
                [style.grid-row]="footerGridRow()"
                [style.grid-column]="dataGridColumn(columnIndex)"
              >
                @if (column.rollup !== 'none') {
                  <div
                    class="min-h-9 px-2 py-1.5 text-right text-sm font-semibold text-slate-700"
                    [attr.aria-label]="'Summary of ' + column.displayName"
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

      @if (borderTip(); as tip) {
        <div
          class="pointer-events-none fixed z-50 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] leading-snug text-white shadow"
          [style.left.px]="tip.x"
          [style.top.px]="tip.y"
          role="tooltip"
        >
          Double-click to fit content
        </div>
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
          <button
            cdkMenuItem
            type="button"
            class="menu-item"
            [disabled]="column.kind === 'chart'"
            (cdkMenuItemTriggered)="addChartColumn(column)"
          >
            Add chart column
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
        <div class="my-1 border-t border-slate-200" role="separator"></div>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="insertColumnsFromSelection('left')"
        >
          Insert column left
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="insertColumnsFromSelection('right')"
        >
          Insert column right
        </button>
        <div class="my-1 border-t border-slate-200" role="separator"></div>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="insertRowFromMenu('above')"
        >
          Insert row above
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="insertRowFromMenu('below')"
        >
          Insert row below
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item text-rose-700"
          (cdkMenuItemTriggered)="deleteRowFromMenu()"
        >
          Delete row
        </button>
      </div>
    </ng-template>

    <ng-template #collapsedMenu>
      <div
        cdkMenu
        class="z-50 w-48 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-700 shadow-xl"
      >
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="expandSelectedRow()"
        >
          Expand
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="store.copySelection()"
        >
          Copy
        </button>
      </div>
    </ng-template>
  `,
  styles: `
    /* One hovered handle lights every handle on its border line. */
    .line-hot {
      background: color-mix(in srgb, var(--color-sky-300) 70%, transparent);
    }
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
  protected readonly suggest = inject(FormulaSuggestService);
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

  /** Visible columns only — hidden ones keep their data but leave the grid. */
  protected readonly renderColumns = computed(() =>
    this.renderTopic().columns.filter((column) => column.hidden !== true),
  );

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
  protected readonly pillAlignment = computed(() => this.topic().pillAlignment ?? 'top');
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

  /** Live width override while a header-edge drag is in flight. */
  protected readonly resizingColumn = signal<{ id: string; width: number } | null>(null);

  protected readonly showRowNumbers = computed(() => this.topic().showRowNumbers === true);
  /** Extra grid column for the row-number gutter. */
  protected readonly numberOffset = computed(() => (this.showRowNumbers() ? 1 : 0));
  protected readonly numberGridColumn = computed(() => this.lattice().depthCount + 1);

  protected readonly gridTemplateColumns = computed(() => {
    const depthCount = this.lattice().depthCount;
    const parts: string[] = [];
    if (depthCount > 0) {
      parts.push(`repeat(${depthCount}, max-content)`);
    }
    if (this.showRowNumbers()) {
      parts.push('max-content');
    }
    const resizing = this.resizingColumn();
    const data = this.renderColumns()
      .map((column) => {
        const width = resizing?.id === column.id ? resizing.width : column.width;
        return width !== undefined ? `${width}px` : 'minmax(6rem, max-content)';
      })
      .join(' ');
    parts.push(data || 'minmax(6rem, max-content)');
    return parts.join(' ');
  });

  /** Live height override while a row-border drag is in flight. */
  protected readonly resizingRow = signal<{ nodeId: string; height: number } | null>(null);

  /** The row's explicit minimum height, live during a drag. */
  protected rowMinHeight(row: LatticeRow): number | null {
    const resizing = this.resizingRow();
    if (resizing?.nodeId === row.nodeId) {
      return resizing.height;
    }
    return this.findNode(row.nodeId)?.rowHeight ?? null;
  }

  /** Border under the pointer: every handle on the same line highlights. */
  protected readonly hotBorder = signal<{ kind: 'column' | 'row'; id: string } | null>(null);
  /** Discoverability tooltip, shown after lingering on a border for 1s. */
  protected readonly borderTip = signal<{ x: number; y: number } | null>(null);
  private borderTipTimer: ReturnType<typeof setTimeout> | null = null;

  protected onBorderHover(kind: 'column' | 'row', id: string, event: PointerEvent): void {
    this.hotBorder.set({ kind, id });
    this.clearBorderTip();
    // Fixed positioning inside a zoomed surface multiplies lengths by the
    // effective zoom — divide so the tip lands at the pointer.
    const scale = this.latticeScale();
    const x = (event.clientX + 12) / scale;
    const y = (event.clientY + 14) / scale;
    this.borderTipTimer = setTimeout(() => this.borderTip.set({ x, y }), 1000);
  }

  protected onBorderLeave(): void {
    this.hotBorder.set(null);
    this.clearBorderTip();
  }

  protected isBorderHot(kind: 'column' | 'row', id: string): boolean {
    const hot = this.hotBorder();
    return hot?.kind === kind && hot.id === id;
  }

  private clearBorderTip(): void {
    if (this.borderTipTimer !== null) {
      clearTimeout(this.borderTipTimer);
      this.borderTipTimer = null;
    }
    this.borderTip.set(null);
  }

  /** Rendered px per layout px at the lattice root (CSS zoom compensation). */
  private latticeScale(): number {
    const root = this.latticeRootRef().nativeElement;
    return root.offsetWidth > 0 ? root.getBoundingClientRect().width / root.offsetWidth : 1;
  }

  /**
   * Border drag (column edges and row bottoms, along their whole line):
   * live preview via the resizing signals, one undo step on release.
   * Pointer deltas are screen px — divided by the rendered/layout ratio of
   * the handle's cell so sizes stay in layout units under card zoom.
   */
  protected startColumnResize(column: ColumnV2, event: PointerEvent): void {
    const cell = (event.currentTarget as HTMLElement).parentElement;
    this.startBorderDrag(event, {
      start: column.width ?? cell?.offsetWidth ?? 96,
      scale:
        cell && cell.offsetWidth > 0 ? cell.getBoundingClientRect().width / cell.offsetWidth : 1,
      axis: 'x',
      preview: (width) =>
        this.resizingColumn.set({ id: column.id, width: clampColumnWidth(width) }),
      commit: () => {
        const result = this.resizingColumn();
        if (result) {
          this.store.setColumnWidth(this.topic().id, column.id, result.width);
        }
        this.resizingColumn.set(null);
      },
      cancel: () => this.resizingColumn.set(null),
    });
  }

  protected startRowResize(row: LatticeRow, event: PointerEvent): void {
    const cell = (event.currentTarget as HTMLElement).parentElement;
    this.startBorderDrag(event, {
      start: this.findNode(row.nodeId)?.rowHeight ?? cell?.offsetHeight ?? 36,
      scale:
        cell && cell.offsetHeight > 0 ? cell.getBoundingClientRect().height / cell.offsetHeight : 1,
      axis: 'y',
      preview: (height) =>
        this.resizingRow.set({ nodeId: row.nodeId, height: clampRowHeight(height) }),
      commit: () => {
        const result = this.resizingRow();
        if (result) {
          this.store.setRowHeight(this.topic().id, row.nodeId, result.height);
        }
        this.resizingRow.set(null);
      },
      cancel: () => this.resizingRow.set(null),
    });
  }

  private startBorderDrag(
    event: PointerEvent,
    session: {
      start: number;
      scale: number;
      axis: 'x' | 'y';
      preview: (size: number) => void;
      commit: () => void;
      cancel: () => void;
    },
  ): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.clearBorderTip();
    const handle = event.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released.
    }
    const startPointer = session.axis === 'x' ? event.clientX : event.clientY;

    const onMove = (moveEvent: PointerEvent): void => {
      const pointer = session.axis === 'x' ? moveEvent.clientX : moveEvent.clientY;
      session.preview(session.start + (pointer - startPointer) / session.scale);
    };
    const cleanup = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
    };
    const onUp = (): void => {
      cleanup();
      session.commit();
    };
    const onCancel = (): void => {
      cleanup();
      session.cancel();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  }

  protected nudgeColumnWidth(column: ColumnV2, event: Event, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    const header = this.latticeRootRef().nativeElement.querySelector<HTMLElement>(
      `[data-header-col="${column.id}"]`,
    );
    const current = column.width ?? header?.offsetWidth ?? 96;
    this.store.setColumnWidth(this.topic().id, column.id, current + delta);
  }

  protected readonly columnCount = computed(
    () => this.lattice().depthCount + this.numberOffset() + this.renderColumns().length,
  );
  protected readonly rowCount = computed(
    () => this.lattice().rows.length + 1 + (this.hasFooter() ? 1 : 0),
  );
  protected readonly hasFooter = computed(() =>
    this.renderColumns().some((column) => column.rollup !== 'none'),
  );

  protected pillsStartingAt(rowStart: number): LatticePill[] {
    return this.lattice().pillsByRowStart.get(rowStart) ?? [];
  }

  protected pillGridRow(pill: LatticePill): string {
    return `${pill.rowStart + 1} / span ${pill.rowSpan}`;
  }

  protected dataGridColumn(columnIndex: number): number {
    return this.lattice().depthCount + this.numberOffset() + columnIndex + 1;
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
    const columns = this.renderColumns();
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
    // First Escape only dismisses the suggestion dropdown.
    if (this.suggest.closeIfOpen()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.editingKey.set(null);
    this.releaseCellFormulaSession();
    (event.target as HTMLElement | null)?.blur();
  }

  protected onCellEditorEnter(nodeId: string, column: ColumnV2, event: Event): void {
    if (this.suggest.accept()) {
      event.preventDefault();
      return;
    }
    this.commitCellEditAndBlur(nodeId, column, event);
  }

  protected onSuggestMove(event: Event, delta: number): void {
    if (this.suggest.move(delta)) {
      event.preventDefault();
    }
  }

  protected onSuggestToggle(event: Event): void {
    event.preventDefault();
    this.suggest.toggle();
  }

  /** Caret moves need a suggestions refresh; plain typing runs through (input). */
  protected onEditorKeyup(event: KeyboardEvent): void {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      this.suggest.refresh();
    }
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
    if (event.button !== 0) {
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
      // Collapsed Rollup Rows select but never edit — their cells are computed.
      if (wasSelected && column.kind !== 'chart' && row.kind === 'leaf') {
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
    if (!this.isCellSelected(row.nodeId, column) && !this.cellInRange(row.nodeId, column)) {
      this.selectCell(row.nodeId, column);
    }
  }

  /** The row the cell menu acts on: the selection's node (anchor for ranges). */
  private menuRowNodeId(): string | null {
    const selection = this.store.selection();
    if (selection?.kind === 'cell' || selection?.kind === 'node') {
      return selection.nodeId;
    }
    if (selection?.kind === 'range') {
      return selection.anchor.nodeId;
    }
    return null;
  }

  protected insertRowFromMenu(side: 'above' | 'below'): void {
    const nodeId = this.menuRowNodeId();
    if (nodeId) {
      this.store.insertSiblingNode(this.topic().id, nodeId, side);
    }
  }

  protected deleteRowFromMenu(): void {
    const nodeId = this.menuRowNodeId();
    if (nodeId) {
      this.requestDeleteNode.emit({ topicId: this.topic().id, nodeId });
    }
  }

  /** Expand from the collapsed row's context menu (cells or the merged row). */
  protected expandSelectedRow(): void {
    const selection = this.store.selection();
    if (selection?.kind === 'cell' || selection?.kind === 'node') {
      this.store.expandNode(selection.nodeId);
    }
  }

  // Merged hidden-row cell (collapsed Branch without any Summary) ------------

  protected hiddenRowLabel(nodeId: string): string {
    const node = this.findNode(nodeId);
    const count = node ? hiddenLeavesOf(node).length : 0;
    return count === 1 ? '1 row hidden' : `${count} rows hidden`;
  }

  protected hiddenRowGridColumn(): string {
    const start = this.lattice().depthCount + this.numberOffset() + 1;
    return `${start} / span ${Math.max(1, this.renderColumns().length)}`;
  }

  protected selectHiddenRow(row: LatticeRow): void {
    this.store.select({ kind: 'node', topicId: this.topic().id, nodeId: row.nodeId });
  }

  protected onHiddenRowPointerDown(row: LatticeRow, event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.selectHiddenRow(row);
    (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
  }

  protected menuCellEditable(): boolean {
    const selection = this.store.selection();
    if (selection?.kind === 'cell') {
      const column = this.topic().columns.find((candidate) => candidate.id === selection.columnId);
      return column?.kind === 'input';
    }
    return selection?.kind === 'range';
  }

  /** Distinct columns covered by the current cell/range selection (visible order). */
  private selectionColumnIds(): string[] {
    const selection = this.store.selection();
    if (selection?.kind === 'cell') {
      return [selection.columnId];
    }
    if (selection?.kind !== 'range') {
      return [];
    }
    const visible = this.renderColumns();
    const anchorIndex = visible.findIndex((column) => column.id === selection.anchor.columnId);
    const focusIndex = visible.findIndex((column) => column.id === selection.focus.columnId);
    if (anchorIndex < 0 || focusIndex < 0) {
      return [];
    }
    const [start, end] =
      anchorIndex <= focusIndex ? [anchorIndex, focusIndex] : [focusIndex, anchorIndex];
    return visible.slice(start, end + 1).map((column) => column.id);
  }

  /** One new column per selected column; same-column cells collapse to one. */
  protected insertColumnsFromSelection(side: 'left' | 'right'): void {
    const ids = this.selectionColumnIds();
    if (ids.length > 0) {
      this.store.insertColumnsAdjacent(this.topic().id, ids, side);
    }
  }

  protected canPasteCells(): boolean {
    return this.store.clipboard()?.kind === 'cells';
  }

  // -------------------------------------------------------------------------
  // Formula editing: while any formula editor is active (a `=` cell editor
  // here or the Details panel's formula field), headers show Reference
  // Names, hovering a column highlights it, and clicking a column inserts
  // its Reference Name at the editor's caret instead of moving the selection.
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
    // Any non-chart column is a target — including the edited column itself
    // (self-references are legal to type, and clicking must never just blur).
    return this.store.formulaEditor() !== null && column.kind !== 'chart';
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
      this.suggest.attach(this.topic().id, input);
    } else {
      this.releaseCellFormulaSession();
    }
  }

  private releaseCellFormulaSession(): void {
    this.suggest.detach();
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
  // Keyboard path: Move up / Move down in the Details panel.
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
      // Dragging a selected header moves the column; dragging an unselected
      // one sweeps a whole-column range selection.
      if (wasSelected) {
        this.startColumnDrag(column, moveEvent);
      } else {
        this.startColumnRangeSelect(column, headerElement, moveEvent);
      }
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

  /**
   * Sweeps a range selection spanning all rows of the columns between the
   * pressed header and the pointer — clicking and dragging headers selects
   * columns; moving a column requires selecting its header first.
   */
  private startColumnRangeSelect(
    column: ColumnV2,
    headerElement: HTMLElement,
    event: PointerEvent,
  ): void {
    const rows = this.lattice().rows;
    if (rows.length === 0) {
      this.selectColumn(column);
      return;
    }
    const root = this.latticeRootRef().nativeElement;
    const rootRect = root.getBoundingClientRect();
    const zoomRatio = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1;
    const columns = this.topic().columns;
    const pointerId = event.pointerId;

    const update = (moveEvent: PointerEvent): void => {
      const x = (moveEvent.clientX - rootRect.left) / zoomRatio;
      let hovered = 0;
      for (const [index, candidate] of columns.entries()) {
        const element = root.querySelector<HTMLElement>(
          `[data-header-col="${CSS.escape(candidate.id)}"]`,
        );
        if (!element) {
          continue;
        }
        if (x >= layoutRectWithin(root, element).left) {
          hovered = index;
        }
      }
      const focusColumn = columns[hovered] ?? column;
      this.store.select({
        kind: 'range',
        topicId: this.topic().id,
        anchor: { nodeId: rows[0]!.nodeId, columnId: column.id },
        focus: { nodeId: rows[rows.length - 1]!.nodeId, columnId: focusColumn.id },
      });
    };
    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId === pointerId) {
        update(moveEvent);
      }
    };
    const cleanup = (): void => {
      headerElement.removeEventListener('pointermove', onMove);
      headerElement.removeEventListener('pointerup', cleanup);
      headerElement.removeEventListener('pointercancel', cleanup);
    };
    headerElement.addEventListener('pointermove', onMove);
    headerElement.addEventListener('pointerup', cleanup);
    headerElement.addEventListener('pointercancel', cleanup);
    update(event);
  }

  /** Header tint while its column is inside the current range selection. */
  protected headerInRange(column: ColumnV2): boolean {
    const selection = this.store.selection();
    if (selection?.kind !== 'range' || selection.topicId !== this.topic().id) {
      return false;
    }
    const columns = this.renderColumns();
    const index = columns.findIndex((candidate) => candidate.id === column.id);
    const anchor = columns.findIndex((candidate) => candidate.id === selection.anchor.columnId);
    const focus = columns.findIndex((candidate) => candidate.id === selection.focus.columnId);
    if (index < 0 || anchor < 0 || focus < 0) {
      return false;
    }
    return index >= Math.min(anchor, focus) && index <= Math.max(anchor, focus);
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
    const columns = this.renderColumns();

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
      fromIndex: this.topic().columns.findIndex((candidate) => candidate.id === column.id),
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

    // Map the visible insertion index onto the full column order (hidden
    // columns keep their relative spots).
    const allColumns = this.topic().columns;
    const fromFull = allColumns.findIndex((candidate) => candidate.id === session.column.id);
    const visibleOthers = allColumns.filter(
      (candidate) => candidate.hidden !== true && candidate.id !== session.column.id,
    );
    const anchorColumn = visibleOthers[index];
    let toFull = anchorColumn
      ? allColumns.findIndex((candidate) => candidate.id === anchorColumn.id)
      : allColumns.length;
    if (fromFull < toFull) {
      toFull -= 1;
    }
    const preview = toFull === fromFull ? null : { columnId: session.column.id, toIndex: toFull };
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
      return cell.value === null ? '' : formatCellNumber(cell.value, column.format);
    }
    const raw = this.inputCellRaw(nodeId, column);
    // Formatted display of raw numbers only when asked — editing shows the raw text.
    if (column.format && column.valueType === 'number') {
      const parsed = Number(raw.trim());
      if (raw.trim().length > 0 && Number.isFinite(parsed)) {
        return formatCellNumber(parsed, column.format);
      }
    }
    return raw;
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
    return value === null ? '—' : formatCellNumber(value, this.chartSourceColumn(column)?.format);
  }

  protected chartBarAria(nodeId: string, column: ColumnV2): string {
    const node = this.findNode(nodeId);
    return `${column.displayName} bar for ${node?.displayName ?? 'row'}: ${this.chartBarLabel(nodeId, column)}`;
  }

  // Rollups -------------------------------------------------------------------

  protected collapsedRollupDisplay(nodeId: string, column: ColumnV2): string {
    const node = this.findNode(nodeId);
    if (!node) {
      return '';
    }
    const total = rollupValue(column, hiddenLeavesOf(node), this.evaluation());
    return total === null ? '' : formatCellNumber(total, column.format);
  }

  protected rollupTitle(column: ColumnV2): string | null {
    return column.rollup === 'none' ? null : 'Summary of hidden rows (read-only)';
  }

  protected rollupAriaLabel(nodeId: string, column: ColumnV2): string {
    const node = this.findNode(nodeId);
    return `Summary of ${column.displayName} for collapsed ${node?.displayName ?? 'branch'}`;
  }

  protected footerRollupDisplay(column: ColumnV2): string {
    const total = rollupValue(column, collectLeaves(this.topic().children), this.evaluation());
    return total === null ? '' : formatCellNumber(total, column.format);
  }

  /** A summarized footer cell draws its own left edge when its neighbour is blank. */
  protected footerNeedsLeftBorder(columnIndex: number): boolean {
    if (columnIndex === 0) {
      return true;
    }
    return this.renderColumns()[columnIndex - 1]?.rollup === 'none';
  }

  // Columns -------------------------------------------------------------------

  protected insertColumn(column: ColumnV2, side: 'left' | 'right'): void {
    this.store.insertColumn(this.topic().id, column.id, side);
  }

  protected addChartColumn(column: ColumnV2): void {
    this.store.addChartColumn(this.topic().id, column.id);
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
