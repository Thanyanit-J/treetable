import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import {
  ACCENT_COLORS,
  AccentColor,
  ChartCardV2,
  ChartConfigV2,
  ChartRowRollup,
  ColumnV2,
  NodeV2,
  NoteCardV2,
  RollupMode,
  TopicCardV2,
  findNodeAndParent,
  isChartableColumn,
  isTopicCard,
} from '../../core/model/document.model';
import {
  DocumentStoreService,
  FormulaEditorSession,
  RefNameTarget,
} from '../../core/store/document-store.service';
import { insertReferenceIntoInput } from './formula-ref-insert';
import { FormulaSuggestService } from './formula-suggest.service';
import { ConfirmDialogComponent } from './ui/confirm-dialog.component';
import { VisibilityItem, VisibilityListComponent } from './ui/visibility-list.component';

const SWATCH_BY_ACCENT: Record<AccentColor, string> = {
  sky: 'bg-sky-400',
  amber: 'bg-amber-400',
  emerald: 'bg-emerald-400',
  rose: 'bg-rose-400',
  violet: 'bg-violet-400',
  slate: 'bg-slate-400',
};

/**
 * The Details panel (CONTEXT.md): detailed editing for the current
 * selection. Everything too rich for a context menu lives here — names,
 * Reference Names, column types, summaries, accents, card layout. It owns
 * the whole right edge; the menubar toggles it away entirely.
 */
@Component({
  selector: 'app-details-panel',
  imports: [ConfirmDialogComponent, NgTemplateOutlet, VisibilityListComponent],
  template: `
    <aside
      class="relative flex h-full shrink-0 flex-col border-l border-slate-200 bg-white"
      [style.width.px]="panelWidth()"
      aria-label="Details"
    >
      <button
        type="button"
        class="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-sky-200/70 focus-visible:bg-sky-300/70 focus-visible:outline-none"
        aria-label="Resize details panel (drag, or arrow keys; double-click resets)"
        (pointerdown)="startPanelResize($event)"
        (keydown.arrowleft)="nudgePanelWidth($event, 16)"
        (keydown.arrowright)="nudgePanelWidth($event, -16)"
        (dblclick)="panelWidth.set(defaultWidth)"
      ></button>
      <div class="border-b border-slate-200 px-3 py-1.5">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-slate-400">Details</h2>
      </div>

      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        @if (chartContext(); as ctx) {
          <p class="section-label">Chart</p>
          <label class="field">
            <span>Name</span>
            <input
              class="field-input"
              [value]="ctx.chart.name ?? ''"
              [attr.placeholder]="autoChartTitle(ctx)"
              (blur)="commitChartName(ctx, $event)"
              (keydown.enter)="blurTarget($event)"
            />
          </label>
          <label class="field">
            <span>Source table</span>
            <select class="field-input" (change)="commitChartCardSource(ctx, $event)">
              @if (!ctx.sourceTopic) {
                <option value="" disabled selected>missing (deleted)</option>
              }
              @for (topicOption of allTopics(); track topicOption.id) {
                <option
                  [value]="topicOption.id"
                  [selected]="topicOption.id === ctx.sourceTopic?.id"
                >
                  {{ topicOption.displayName }}
                </option>
              }
            </select>
          </label>
          <fieldset class="field">
            <legend>Type</legend>
            <div class="flex gap-1">
              <button
                type="button"
                class="choice"
                [class.choice-active]="ctx.chart.type === 'bar'"
                (click)="store.setChartType(ctx.ownerId, ctx.chart.id, 'bar')"
              >
                Bar
              </button>
              <button
                type="button"
                class="choice"
                [class.choice-active]="ctx.chart.type === 'line'"
                (click)="store.setChartType(ctx.ownerId, ctx.chart.id, 'line')"
              >
                Line
              </button>
              <button
                type="button"
                class="choice"
                [class.choice-active]="ctx.chart.type === 'pie'"
                (click)="store.setChartType(ctx.ownerId, ctx.chart.id, 'pie')"
              >
                Pie
              </button>
            </div>
          </fieldset>
          <fieldset class="field">
            <legend>{{ ctx.chart.type === 'pie' ? 'Slices from' : 'X axis' }}</legend>
            <div class="flex gap-1">
              <button
                type="button"
                class="choice"
                [class.choice-active]="(ctx.chart.categoryAxis ?? 'rows') === 'rows'"
                (click)="store.setChartCategoryAxis(ctx.ownerId, ctx.chart.id, 'rows')"
              >
                Rows
              </button>
              <button
                type="button"
                class="choice"
                [class.choice-active]="ctx.chart.categoryAxis === 'columns'"
                (click)="store.setChartCategoryAxis(ctx.ownerId, ctx.chart.id, 'columns')"
              >
                Columns
              </button>
            </div>
            <p class="mt-1 text-xs text-slate-400">
              The other dimension becomes the coloured series.
            </p>
          </fieldset>
          @if ((ctx.chart.categoryAxis ?? 'rows') === 'rows') {
            <label class="field">
              <span>{{ ctx.chart.type === 'pie' ? 'Slice labels' : 'X axis labels' }}</span>
              <select class="field-input" (change)="commitChartLabelColumn(ctx, $event)">
                <option value="" [selected]="!ctx.chart.labelColumn">Row name</option>
                @for (option of labelColumnOptions(ctx); track option.id) {
                  <option
                    [value]="option.refName"
                    [selected]="option.refName === ctx.chart.labelColumn"
                  >
                    {{ option.displayName }}
                  </option>
                }
              </select>
              <span class="mt-1 block text-[11px] font-normal text-slate-400">
                Label categories from a column — e.g. an account name or ticker text column.
              </span>
            </label>
          }
          @if (ctx.chart.type === 'bar') {
            <fieldset class="field">
              <legend>Direction</legend>
              <div class="flex gap-1">
                <button
                  type="button"
                  class="choice"
                  [class.choice-active]="!ctx.chart.horizontal"
                  (click)="store.setChartHorizontal(ctx.ownerId, ctx.chart.id, false)"
                >
                  Vertical
                </button>
                <button
                  type="button"
                  class="choice"
                  [class.choice-active]="ctx.chart.horizontal === true"
                  (click)="store.setChartHorizontal(ctx.ownerId, ctx.chart.id, true)"
                >
                  Horizontal
                </button>
              </div>
            </fieldset>
          }
          <fieldset class="field">
            <legend>Sources</legend>
            <app-visibility-list
              [visible]="sourceItems(ctx)"
              [hidden]="hiddenSourceItems(ctx)"
              [reorderable]="true"
              (reordered)="
                store.moveChartColumn(ctx.ownerId, ctx.chart.id, $event.fromIndex, $event.toIndex)
              "
              (hideItems)="store.setChartColumnsIncluded(ctx.ownerId, ctx.chart.id, $event, false)"
              (showItems)="store.setChartColumnsIncluded(ctx.ownerId, ctx.chart.id, $event, true)"
            />
          </fieldset>
          <fieldset class="field">
            <legend>Rows</legend>
            <label class="mb-2 block">
              <span
                class="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400"
              >
                Group by
              </span>
              <select class="field-input" (change)="commitRowGrouping(ctx, $event)">
                <option value="" [selected]="rowGroupingValue(ctx) === ''">Every leaf row</option>
                @for (level of groupLevels(ctx); track level) {
                  <option [value]="level" [selected]="rowGroupingValue(ctx) === level.toString()">
                    Level {{ level }} groups
                  </option>
                }
                @if (rowGroupingValue(ctx) === 'custom') {
                  <option value="custom" disabled selected>Custom selection (below)</option>
                }
              </select>
              <span class="mt-1 block text-[11px] font-normal text-slate-400">
                Level 1 charts each top-level branch as one bar, its rows combined by the group
                function.
              </span>
            </label>
            <app-visibility-list
              [visible]="chartRowItems(ctx, true)"
              [hidden]="chartRowItems(ctx, false)"
              (hideItems)="store.setChartRowsIncluded(ctx.ownerId, ctx.chart.id, $event, false)"
              (showItems)="store.setChartRowsIncluded(ctx.ownerId, ctx.chart.id, $event, true)"
            />
            <label class="mt-2 block">
              <span
                class="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400"
              >
                Group function
              </span>
              <select
                class="field-input"
                [value]="ctx.chart.rowRollup ?? 'sum'"
                (change)="commitChartRowRollup(ctx, $event)"
              >
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="min">Min</option>
                <option value="max">Max</option>
                <option value="count">Count</option>
              </select>
            </label>
            <p class="mt-1 text-[11px] font-normal text-slate-400">
              How a group (branch) row combines the rows beneath it, per column — independent of the
              columns' own Summary.
            </p>
          </fieldset>
          <button
            type="button"
            class="danger-button"
            (click)="store.removeOwnedChart(ctx.ownerId, ctx.chart.id)"
          >
            Delete chart
          </button>
        } @else if (topic(); as topic) {
          @switch (selectionKind()) {
            @case ('card') {
              <p class="section-label">Topic</p>
              <label class="field">
                <span>Card title</span>
                <input
                  class="field-input"
                  [value]="topic.cardTitle ?? ''"
                  [attr.placeholder]="topic.displayName"
                  (blur)="commitCardTitle(topic, $event)"
                  (keydown.enter)="blurTarget($event)"
                />
              </label>
              <label class="field">
                <span>Root name</span>
                <input
                  class="field-input"
                  [value]="topic.displayName"
                  (blur)="commitCardName(topic, $event)"
                  (keydown.enter)="blurTarget($event)"
                />
              </label>
              <label class="field">
                <span>Reference name</span>
                <input
                  class="field-input font-mono"
                  [value]="topic.refName"
                  [disabled]="!topic.customRefName"
                  [attr.aria-invalid]="refNameError() ? 'true' : null"
                  (blur)="
                    commitRefName({ kind: 'topic', topicId: topic.id, entityId: topic.id }, $event)
                  "
                  (keydown.enter)="blurTarget($event)"
                />
              </label>
              <label class="flex items-center gap-2 text-xs text-slate-500">
                <input
                  type="checkbox"
                  [checked]="!topic.customRefName"
                  (change)="
                    toggleRefSync({ kind: 'topic', topicId: topic.id, entityId: topic.id }, $event)
                  "
                />
                Auto-sync with name
              </label>
              <fieldset class="field">
                <legend>Tree layout</legend>
                <div class="flex gap-1">
                  <button
                    type="button"
                    class="choice"
                    [class.choice-active]="(topic.pillAlignment ?? 'top') === 'top'"
                    (click)="store.setPillAlignment(topic.id, 'top')"
                  >
                    Top-down
                  </button>
                  <button
                    type="button"
                    class="choice"
                    [class.choice-active]="topic.pillAlignment === 'center'"
                    (click)="store.setPillAlignment(topic.id, 'center')"
                  >
                    Middle
                  </button>
                </div>
              </fieldset>
              <fieldset class="field">
                <legend>Connectors</legend>
                <div class="flex gap-1">
                  <button
                    type="button"
                    class="choice"
                    [class.choice-active]="(topic.connectorStyle ?? 'elbow') === 'elbow'"
                    (click)="store.setConnectorStyle(topic.id, 'elbow')"
                  >
                    Elbow
                  </button>
                  <button
                    type="button"
                    class="choice"
                    [class.choice-active]="topic.connectorStyle === 'straight'"
                    (click)="store.setConnectorStyle(topic.id, 'straight')"
                  >
                    Straight
                  </button>
                  <button
                    type="button"
                    class="choice"
                    [class.choice-active]="topic.connectorStyle === 'curved'"
                    (click)="store.setConnectorStyle(topic.id, 'curved')"
                  >
                    Curved
                  </button>
                </div>
              </fieldset>
              <label class="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  [checked]="topic.showRoot ?? true"
                  (change)="toggleShowRoot(topic, $event)"
                />
                Show root node
              </label>
              <label class="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  [checked]="topic.showRowNumbers === true"
                  (change)="toggleShowRowNumbers(topic, $event)"
                />
                Show row numbers
              </label>
              <fieldset class="field">
                <legend>Table size</legend>
                <div class="flex gap-2">
                  <label class="min-w-0 flex-1">
                    <span class="mb-1 block text-[11px] font-medium text-slate-400">
                      Width (px)
                    </span>
                    <input
                      class="field-input"
                      type="number"
                      min="256"
                      max="1600"
                      placeholder="auto"
                      [value]="topic.sizing?.width ?? ''"
                      (change)="commitCardDimension(topic, 'width', $event)"
                      (keydown.enter)="blurTarget($event)"
                    />
                  </label>
                  <label class="min-w-0 flex-1">
                    <span class="mb-1 block text-[11px] font-medium text-slate-400">
                      Height (px)
                    </span>
                    <input
                      class="field-input"
                      type="number"
                      min="160"
                      max="1600"
                      placeholder="auto"
                      [value]="topic.sizing?.height ?? ''"
                      (change)="commitCardDimension(topic, 'height', $event)"
                      (keydown.enter)="blurTarget($event)"
                    />
                  </label>
                </div>
                <label class="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    [checked]="topic.sizing?.fixed !== true"
                    (change)="toggleCardAutoExpand(topic, $event)"
                  />
                  Auto-expand beyond this size
                </label>
              </fieldset>
              <fieldset class="field">
                <legend>Columns</legend>
                <app-visibility-list
                  [visible]="columnItems(visibleColumns(topic))"
                  [hidden]="columnItems(hiddenColumns(topic))"
                  [reorderable]="true"
                  (reordered)="store.moveVisibleColumn(topic.id, $event.id, $event.toIndex)"
                  (hideItems)="store.setColumnsHidden(topic.id, $event, true)"
                  (showItems)="store.setColumnsHidden(topic.id, $event, false)"
                />
              </fieldset>
              <button
                type="button"
                class="danger-button"
                (click)="requestDeleteTopic.emit(topic.id)"
              >
                Delete topic
              </button>
            }
            @case ('node') {
              @if (node(); as node) {
                <p class="section-label">Node</p>
                <label class="field">
                  <span>Name</span>
                  <input
                    class="field-input"
                    [value]="node.displayName"
                    (blur)="commitNodeName(topic, node, $event)"
                    (keydown.enter)="blurTarget($event)"
                  />
                </label>
                <label class="field">
                  <span>Reference name</span>
                  <input
                    class="field-input font-mono"
                    [value]="node.refName"
                    [disabled]="!node.customRefName"
                    [attr.aria-invalid]="refNameError() ? 'true' : null"
                    (blur)="
                      commitRefName({ kind: 'node', topicId: topic.id, entityId: node.id }, $event)
                    "
                    (keydown.enter)="blurTarget($event)"
                  />
                </label>
                <label class="flex items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    [checked]="!node.customRefName"
                    (change)="
                      toggleRefSync({ kind: 'node', topicId: topic.id, entityId: node.id }, $event)
                    "
                  />
                  Auto-sync with name
                </label>
                <fieldset class="field">
                  <legend>Color</legend>
                  <div class="flex items-center gap-1.5">
                    @for (color of accentColors; track color) {
                      <button
                        type="button"
                        class="h-5 w-5 rounded-full border border-white shadow ring-slate-400 hover:ring-2"
                        [class]="swatchClass(color)"
                        [class.ring-2]="node.accent === color"
                        [attr.aria-label]="'Set color ' + color"
                        [attr.aria-pressed]="node.accent === color"
                        (click)="store.setNodeAccent(topic.id, node.id, color)"
                      ></button>
                    }
                    <button
                      type="button"
                      class="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
                      (click)="store.setNodeAccent(topic.id, node.id, null)"
                    >
                      None
                    </button>
                  </div>
                </fieldset>
                <div class="flex flex-wrap gap-1">
                  <button
                    type="button"
                    class="action"
                    (click)="store.addChildNode(topic.id, node.id)"
                  >
                    Add child
                  </button>
                  <button
                    type="button"
                    class="action"
                    (click)="store.addSiblingNode(topic.id, node.id)"
                  >
                    Add below
                  </button>
                  <button
                    type="button"
                    class="action"
                    [disabled]="!store.canMoveNodeAmongSiblings(topic.id, node.id, -1)"
                    (click)="store.moveNodeAmongSiblings(topic.id, node.id, -1)"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    class="action"
                    [disabled]="!store.canMoveNodeAmongSiblings(topic.id, node.id, 1)"
                    (click)="store.moveNodeAmongSiblings(topic.id, node.id, 1)"
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    class="action"
                    (click)="store.duplicateNode(topic.id, node.id)"
                  >
                    Duplicate
                  </button>
                </div>
                <button
                  type="button"
                  class="danger-button"
                  (click)="requestDeleteNode.emit({ topicId: topic.id, nodeId: node.id })"
                >
                  Delete node
                </button>
              }
            }
            @case ('column') {
              @if (column(); as column) {
                <p class="section-label">Column</p>
                <label class="field">
                  <span>Name</span>
                  <input
                    class="field-input"
                    [value]="column.displayName"
                    (blur)="commitColumnName(topic, column, $event)"
                    (keydown.enter)="blurTarget($event)"
                  />
                </label>
                <label class="field">
                  <span>Reference name</span>
                  <input
                    class="field-input font-mono"
                    [value]="column.refName"
                    [disabled]="!column.customRefName"
                    [attr.aria-invalid]="refNameError() ? 'true' : null"
                    (blur)="
                      commitRefName(
                        { kind: 'column', topicId: topic.id, entityId: column.id },
                        $event
                      )
                    "
                    (keydown.enter)="blurTarget($event)"
                  />
                </label>
                <label class="flex items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    [checked]="!column.customRefName"
                    (change)="
                      toggleRefSync(
                        { kind: 'column', topicId: topic.id, entityId: column.id },
                        $event
                      )
                    "
                  />
                  Auto-sync with name
                </label>
                <ng-container
                  [ngTemplateOutlet]="columnSettings"
                  [ngTemplateOutletContext]="{ topic: topic, column: column, node: null }"
                />
                <button type="button" class="danger-button" (click)="deleteColumn(topic, column)">
                  Delete column
                </button>
              }
            }
            @case ('cell') {
              @if (cellContext(); as context) {
                <p class="section-label">Cell</p>
                <p class="text-sm text-slate-600">
                  {{ context.node.displayName }} · {{ context.column.displayName }}
                </p>
                @if (context.node.children.length > 0) {
                  <p class="text-xs text-slate-400">
                    Summary of the collapsed branch's hidden rows — expand to edit them.
                  </p>
                  <div class="flex flex-wrap gap-1">
                    <button type="button" class="action" (click)="store.copySelection()">
                      Copy
                    </button>
                    <button
                      type="button"
                      class="action"
                      (click)="store.expandNode(context.node.id)"
                    >
                      Expand
                    </button>
                  </div>
                } @else if (context.column.kind === 'input') {
                  <label class="field">
                    <span>Value</span>
                    <input
                      class="field-input"
                      [value]="cellRawOf(context)"
                      (blur)="commitCellValue(topic, context, $event)"
                      (keydown.enter)="blurTarget($event)"
                    />
                  </label>
                } @else if (context.column.kind === 'computed') {
                  <p class="text-xs text-slate-400">
                    Computed by the column formula — edit it below.
                  </p>
                }
                @if (context.node.children.length === 0) {
                  <div class="flex flex-wrap gap-1">
                    <button type="button" class="action" (click)="store.copySelection()">
                      Copy
                    </button>
                    <button
                      type="button"
                      class="action"
                      [disabled]="context.column.kind !== 'input'"
                      (click)="store.copySelection(true)"
                    >
                      Cut
                    </button>
                    <button
                      type="button"
                      class="action"
                      [disabled]="!canPasteCells()"
                      (click)="store.pasteSelection()"
                    >
                      Paste
                    </button>
                    <button
                      type="button"
                      class="action"
                      [disabled]="context.column.kind !== 'input'"
                      (click)="store.clearSelectedCells()"
                    >
                      Clear
                    </button>
                  </div>
                }
                <p class="section-label">Column · {{ context.column.displayName }}</p>
                <ng-container
                  [ngTemplateOutlet]="columnSettings"
                  [ngTemplateOutletContext]="{
                    topic: topic,
                    column: context.column,
                    node: context.node,
                  }"
                />
              }
            }
            @case ('range') {
              <p class="section-label">Cells</p>
              <p class="text-sm text-slate-600">Multiple cells selected.</p>
              <div class="flex flex-wrap gap-1">
                <button type="button" class="action" (click)="store.copySelection()">Copy</button>
                <button type="button" class="action" (click)="store.copySelection(true)">
                  Cut
                </button>
                <button
                  type="button"
                  class="action"
                  [disabled]="!canPasteCells()"
                  (click)="store.pasteSelection()"
                >
                  Paste
                </button>
                <button type="button" class="action" (click)="store.clearSelectedCells()">
                  Clear
                </button>
              </div>
              @if (rangeColumns().length > 0) {
                <label class="field">
                  <span>
                    Summary — {{ rangeColumns().length }}
                    {{ rangeColumns().length === 1 ? 'column' : 'columns' }} at once
                  </span>
                  <select
                    class="field-input"
                    [value]="rangeRollupValue()"
                    (change)="commitRangeRollup(topic, $event)"
                  >
                    @if (rangeRollupValue() === '') {
                      <option value="" disabled>Mixed</option>
                    }
                    <option value="none">None</option>
                    <option value="sum">Sum</option>
                    <option value="avg">Average</option>
                    <option value="min">Min</option>
                    <option value="max">Max</option>
                    <option value="count">Count</option>
                  </select>
                </label>
              }
            }
          }
          @if (refNameError(); as message) {
            <p class="text-xs text-rose-600" role="alert">{{ message }}</p>
          }
        } @else if (cardContext(); as card) {
          @switch (card.kind) {
            @case ('note') {
              <p class="section-label">Note</p>
              <fieldset class="field">
                <legend>Format</legend>
                <div class="flex gap-1">
                  <button
                    type="button"
                    class="choice"
                    [class.choice-active]="(card.format ?? 'text') === 'text'"
                    (click)="store.setNoteFormat(card.id, 'text')"
                  >
                    Text
                  </button>
                  <button
                    type="button"
                    class="choice"
                    [class.choice-active]="card.format === 'markdown'"
                    (click)="store.setNoteFormat(card.id, 'markdown')"
                  >
                    Markdown
                  </button>
                </div>
              </fieldset>
              @if (card.format === 'markdown') {
                <p class="text-xs text-slate-400">
                  Supports # headings, **bold**, *italic*, \`code\`, - lists and links.
                </p>
              }
              <button type="button" class="danger-button" (click)="store.removeCard(card.id)">
                Delete note
              </button>
            }
            @case ('chartcard') {
              <p class="section-label">Charts card</p>
              <p class="text-sm text-slate-600">
                Source: {{ chartCardSource(card)?.displayName ?? 'missing (deleted)' }}
              </p>
              <p class="text-xs text-slate-400">Click a chart in the card to edit it here.</p>
              <button type="button" class="danger-button" (click)="store.removeCard(card.id)">
                Delete charts card
              </button>
            }
          }
        } @else {
          <p class="text-sm text-slate-400">
            Select a topic, node, column or cell to edit its details here.
          </p>
        }
      </div>
    </aside>

    <app-confirm-dialog
      [open]="pendingFormulaToValue() !== null"
      title="Convert formula to values"
      [message]="formulaToValueMessage()"
      confirmLabel="Convert to values"
      (confirmed)="confirmFormulaToValue()"
      (cancelled)="pendingFormulaToValue.set(null)"
    />

    <!-- Column controls shared by the column section and the cell section;
         a cell also brings its node, unlocking the row height field. -->
    <ng-template #columnSettings let-topic="topic" let-column="column" let-node="node">
      @if (column.kind !== 'chart') {
        <fieldset class="field">
          <legend>Type</legend>
          <div class="flex gap-1">
            <button
              type="button"
              class="choice"
              [class.choice-active]="column.kind === 'input'"
              (click)="requestValueKind(topic, column)"
            >
              Value
            </button>
            <button
              type="button"
              class="choice"
              [class.choice-active]="column.kind === 'computed'"
              (click)="store.setColumnKind(topic.id, column.id, 'computed')"
            >
              Formula
            </button>
          </div>
        </fieldset>
      }
      @switch (column.kind) {
        @case ('input') {
          <fieldset class="field">
            <legend>Value type</legend>
            <div class="flex gap-1">
              <button
                type="button"
                class="choice"
                [class.choice-active]="column.valueType === 'number'"
                (click)="store.setColumnValueType(topic.id, column.id, 'number')"
              >
                Number
              </button>
              <button
                type="button"
                class="choice"
                [class.choice-active]="column.valueType === 'text'"
                (click)="store.setColumnValueType(topic.id, column.id, 'text')"
              >
                Text
              </button>
            </div>
          </fieldset>
        }
        @case ('computed') {
          <label class="field">
            <span>Formula</span>
            <input
              class="field-input font-mono"
              [value]="column.expression ?? '='"
              placeholder="= $Amount * $Rate"
              (focus)="beginFormulaSession(topic, column, $event)"
              (input)="suggest.refresh()"
              (keyup)="onFormulaKeyup($event)"
              (click)="suggest.refresh()"
              (blur)="commitExpression(topic, column, $event)"
              (keydown.enter)="onFormulaEnter($event)"
              (keydown.arrowdown)="onSuggestMove($event, 1)"
              (keydown.arrowup)="onSuggestMove($event, -1)"
              (keydown.control.i)="onSuggestToggle($event)"
              (keydown.meta.i)="onSuggestToggle($event)"
              (keydown.escape)="onFormulaEscape($event)"
            />
            <span class="mt-1 block text-[11px] font-normal text-slate-400">
              Click a column in any card to insert its reference.
            </span>
          </label>
        }
        @case ('chart') {
          <label class="field">
            <span>Bar chart of</span>
            <!-- [selected] per option, not [value] on the select: the
                 select's value would be assigned before the @for
                 options exist, silently showing the first option. -->
            <select class="field-input" (change)="commitChartSource(topic, column, $event)">
              @for (option of chartSourceOptions(topic, column); track option.id) {
                <option [value]="option.refName" [selected]="option.refName === column.chartSource">
                  {{ option.displayName }}
                </option>
              }
            </select>
          </label>
          <p class="text-xs text-slate-400">
            A chart column visualizes another column — re-point it or delete it.
          </p>
        }
      }
      @if (
        column.kind === 'computed' || (column.kind === 'input' && column.valueType === 'number')
      ) {
        <fieldset class="field">
          <legend>Number format</legend>
          <label class="flex items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              [checked]="column.format?.thousands === true"
              (change)="toggleFormatThousands(topic, column, $event)"
            />
            Thousands separator (1,234)
          </label>
          <label class="mt-2 block">
            <span class="mb-1 block text-[11px] font-medium text-slate-400">Decimal places</span>
            <input
              class="field-input"
              type="number"
              min="0"
              max="10"
              placeholder="as typed"
              [value]="column.format?.decimals ?? ''"
              (change)="commitFormatDecimals(topic, column, $event)"
              (keydown.enter)="blurTarget($event)"
            />
          </label>
          <div class="mt-2">
            <span class="mb-1 block text-[11px] font-medium text-slate-400">Negative values</span>
            <div class="flex gap-1">
              <button
                type="button"
                class="choice"
                [class.choice-active]="column.format?.negativeParens !== true"
                (click)="
                  store.setColumnNumberFormat(topic.id, column.id, { negativeParens: false })
                "
              >
                -1,234
              </button>
              <button
                type="button"
                class="choice"
                [class.choice-active]="column.format?.negativeParens === true"
                (click)="store.setColumnNumberFormat(topic.id, column.id, { negativeParens: true })"
              >
                (1,234)
              </button>
            </div>
          </div>
        </fieldset>
      }
      @if (column.kind !== 'chart') {
        <label class="field">
          <span>Summary (footer + collapsed rows)</span>
          <select
            class="field-input"
            [value]="column.rollup"
            (change)="commitRollup(topic, column, $event)"
          >
            <option value="none">None</option>
            <option value="sum">Sum</option>
            <option value="avg">Average</option>
            <option value="min">Min</option>
            <option value="max">Max</option>
            <option value="count">Count</option>
          </select>
        </label>
        <fieldset class="field">
          <legend>When text overflows</legend>
          <div class="flex gap-1">
            <button
              type="button"
              class="choice"
              [class.choice-active]="column.wrap !== true"
              (click)="store.setColumnWrap(topic.id, column.id, false)"
            >
              Clip
            </button>
            <button
              type="button"
              class="choice"
              [class.choice-active]="column.wrap === true"
              (click)="store.setColumnWrap(topic.id, column.id, true)"
            >
              Wrap
            </button>
          </div>
          <div class="mt-2 flex gap-2">
            <label class="min-w-0 flex-1">
              <span class="mb-1 block text-[11px] font-medium text-slate-400">Width (px)</span>
              <input
                class="field-input"
                type="number"
                min="48"
                max="960"
                placeholder="auto"
                [value]="column.width ?? ''"
                (change)="commitColumnWidth(topic, column, $event)"
                (keydown.enter)="blurTarget($event)"
              />
            </label>
            @if (node) {
              <label class="min-w-0 flex-1">
                <span class="mb-1 block text-[11px] font-medium text-slate-400">
                  Row height (px)
                </span>
                <input
                  class="field-input"
                  type="number"
                  min="24"
                  max="480"
                  placeholder="auto"
                  [value]="node.rowHeight ?? ''"
                  (change)="commitRowHeight(topic, node, $event)"
                  (keydown.enter)="blurTarget($event)"
                />
              </label>
            }
          </div>
        </fieldset>
      }
    </ng-template>
  `,
  styles: `
    .section-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-slate-400);
    }
    .field {
      display: block;
      font-size: 0.75rem;
      color: var(--color-slate-500);
    }
    .field > span,
    .field > legend {
      display: block;
      margin-bottom: 0.25rem;
      font-weight: 500;
    }
    .field-input {
      width: 100%;
      border-radius: 0.5rem;
      border: 1px solid var(--color-slate-300);
      padding: 0.375rem 0.5rem;
      font-size: 0.875rem;
      color: var(--color-slate-800);
      background: white;
    }
    .field-input:focus-visible {
      outline: 2px solid var(--color-sky-600);
      outline-offset: -1px;
    }
    .field-input:disabled {
      background: var(--color-slate-50);
      color: var(--color-slate-400);
    }
    .choice {
      border-radius: 0.5rem;
      border: 1px solid var(--color-slate-300);
      background: white;
      padding: 0.25rem 0.625rem;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--color-slate-600);
    }
    .choice-active {
      border-color: var(--color-sky-400);
      background: var(--color-sky-50);
      color: var(--color-sky-700);
    }
    .choice:disabled {
      opacity: 0.4;
    }
    .action {
      border-radius: 0.5rem;
      border: 1px solid var(--color-slate-300);
      background: white;
      padding: 0.25rem 0.625rem;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--color-slate-600);
    }
    .action:hover:not(:disabled) {
      background: var(--color-slate-50);
    }
    .action:disabled {
      opacity: 0.4;
    }
    .danger-button {
      width: 100%;
      border-radius: 0.5rem;
      border: 1px solid var(--color-rose-200);
      background: var(--color-rose-50);
      padding: 0.375rem 0.625rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--color-rose-700);
    }
    .danger-button:hover {
      background: var(--color-rose-100);
    }
    button:focus-visible {
      outline: 2px solid var(--color-sky-600);
      outline-offset: 1px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailsPanelComponent {
  protected readonly store = inject(DocumentStoreService);
  protected readonly suggest = inject(FormulaSuggestService);

  readonly requestDeleteTopic = output<string>();
  readonly requestDeleteNode = output<{ topicId: string; nodeId: string }>();
  readonly notify = output<string>();

  protected readonly accentColors = ACCENT_COLORS;
  protected readonly refNameError = signal<string | null>(null);
  protected readonly defaultWidth = 288;
  /** Ephemeral view state, adjustable by dragging the left border. */
  protected readonly panelWidth = signal(this.defaultWidth);
  private formulaSession: FormulaEditorSession | null = null;

  protected startPanelResize(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released.
    }
    const startX = event.clientX;
    const startWidth = this.panelWidth();
    const onMove = (moveEvent: PointerEvent): void => {
      // Left-edge handle: dragging left grows the panel.
      this.panelWidth.set(this.clampWidth(startWidth - (moveEvent.clientX - startX)));
    };
    const cleanup = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', cleanup);
      handle.removeEventListener('pointercancel', cleanup);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', cleanup);
    handle.addEventListener('pointercancel', cleanup);
  }

  protected nudgePanelWidth(event: Event, delta: number): void {
    event.preventDefault();
    this.panelWidth.set(this.clampWidth(this.panelWidth() + delta));
  }

  private clampWidth(width: number): number {
    return Math.min(560, Math.max(240, Math.round(width)));
  }

  /** Formula column awaiting the destructive convert-to-values confirmation. */
  protected readonly pendingFormulaToValue = signal<{
    topicId: string;
    columnId: string;
    displayName: string;
    expression: string;
  } | null>(null);

  protected readonly selectionKind = computed(() => this.store.selection()?.kind ?? null);

  /** Selected chart with its owning Charts card and the Topic feeding it. */
  protected readonly chartContext = computed<{
    ownerId: string;
    chart: ChartConfigV2;
    sourceTopic: TopicCardV2 | null;
  } | null>(() => {
    const selection = this.store.selection();
    if (selection?.kind !== 'chart') {
      return null;
    }
    const owner = this.store.cardById(selection.topicId);
    if (owner?.kind !== 'chartcard') {
      return null;
    }
    const chart = owner.charts.find((candidate) => candidate.id === selection.chartId);
    if (!chart) {
      return null;
    }
    const sourceTopic = this.store.topicById(owner.sourceTopicId) ?? null;
    return { ownerId: selection.topicId, chart, sourceTopic };
  });

  /** Every Topic in the Document — Charts cards can re-point at any of them. */
  protected readonly allTopics = computed(() => this.store.cards().filter(isTopicCard));

  protected commitChartCardSource(context: { ownerId: string }, event: Event): void {
    this.store.setChartCardSource(context.ownerId, (event.target as HTMLSelectElement).value);
  }

  /** Source columns not currently on the chart. */
  protected hiddenSources(context: {
    chart: ChartConfigV2;
    sourceTopic: TopicCardV2 | null;
  }): { refName: string; displayName: string }[] {
    if (!context.sourceTopic) {
      return [];
    }
    // Text columns carry labels, not values — they are offered as X labels.
    return context.sourceTopic.columns
      .filter(
        (column) => isChartableColumn(column) && !context.chart.columns.includes(column.refName),
      )
      .map((column) => ({ refName: column.refName, displayName: column.displayName }));
  }

  /** Any non-chart column can label the categories (text columns shine here). */
  protected labelColumnOptions(context: { sourceTopic: TopicCardV2 | null }): ColumnV2[] {
    return (context.sourceTopic?.columns ?? []).filter((column) => column.kind !== 'chart');
  }

  protected commitChartLabelColumn(
    context: { ownerId: string; chart: ChartConfigV2 },
    event: Event,
  ): void {
    const value = (event.target as HTMLSelectElement).value;
    this.store.setChartLabelColumn(context.ownerId, context.chart.id, value === '' ? null : value);
  }

  /** Tree levels offering meaningful grouping: above the deepest one. */
  protected groupLevels(context: { sourceTopic: TopicCardV2 | null }): number[] {
    const topic = context.sourceTopic;
    if (!topic) {
      return [];
    }
    let maxDepth = 0;
    const descend = (nodes: readonly NodeV2[], depth: number): void => {
      for (const node of nodes) {
        maxDepth = Math.max(maxDepth, depth);
        descend(node.children, depth + 1);
      }
    };
    descend(topic.children, 1);
    return Array.from({ length: Math.max(0, maxDepth - 1) }, (_, index) => index + 1);
  }

  /** '' = every Leaf (default), a level number, or 'custom' for hand-picked rows. */
  protected rowGroupingValue(context: {
    chart: ChartConfigV2;
    sourceTopic: TopicCardV2 | null;
  }): string {
    if (!context.chart.rows) {
      return '';
    }
    const topic = context.sourceTopic;
    if (!topic) {
      return 'custom';
    }
    const rowsKey = context.chart.rows.join('\n');
    for (const level of this.groupLevels(context)) {
      if (this.store.nodeIdsAtLevel(topic, level).join('\n') === rowsKey) {
        return String(level);
      }
    }
    return 'custom';
  }

  protected commitRowGrouping(
    context: { ownerId: string; chart: ChartConfigV2 },
    event: Event,
  ): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'custom') {
      return;
    }
    this.store.setChartRowGrouping(
      context.ownerId,
      context.chart.id,
      value === '' ? null : Number(value),
    );
  }

  protected sourceLabel(context: { sourceTopic: TopicCardV2 | null }, refName: string): string {
    return (
      context.sourceTopic?.columns.find((column) => column.refName === refName)?.displayName ??
      refName
    );
  }

  protected autoChartTitle(context: {
    chart: ChartConfigV2;
    sourceTopic: TopicCardV2 | null;
  }): string {
    return context.chart.columns.map((ref) => this.sourceLabel(context, ref)).join(', ') || '—';
  }

  protected commitChartName(
    context: { ownerId: string; chart: ChartConfigV2 },
    event: Event,
  ): void {
    this.store.renameChart(
      context.ownerId,
      context.chart.id,
      (event.target as HTMLInputElement).value,
    );
  }

  protected commitChartRowRollup(
    context: { ownerId: string; chart: ChartConfigV2 },
    event: Event,
  ): void {
    this.store.setChartRowRollup(
      context.ownerId,
      context.chart.id,
      (event.target as HTMLSelectElement).value as ChartRowRollup,
    );
  }

  protected sourceItems(context: {
    chart: ChartConfigV2;
    sourceTopic: TopicCardV2 | null;
  }): VisibilityItem[] {
    return context.chart.columns.map((ref) => ({ id: ref, label: this.sourceLabel(context, ref) }));
  }

  protected hiddenSourceItems(context: {
    chart: ChartConfigV2;
    sourceTopic: TopicCardV2 | null;
  }): VisibilityItem[] {
    return this.hiddenSources(context).map((option) => ({
      id: option.refName,
      label: option.displayName,
    }));
  }

  protected columnItems(columns: ColumnV2[]): VisibilityItem[] {
    return columns.map((column) => ({ id: column.id, label: column.displayName }));
  }

  /** Every node of the source tree, indented by depth, split by inclusion. */
  protected chartRowItems(
    context: { chart: ChartConfigV2; sourceTopic: TopicCardV2 | null },
    included: boolean,
  ): VisibilityItem[] {
    const topic = context.sourceTopic;
    if (!topic) {
      return [];
    }
    const selected = new Set(this.store.effectiveChartRowIds(topic, context.chart));
    const items: VisibilityItem[] = [];
    const walk = (nodes: readonly NodeV2[], depth: number): void => {
      for (const node of nodes) {
        if (selected.has(node.id) === included) {
          items.push({ id: node.id, label: node.displayName, indent: depth });
        }
        walk(node.children, depth + 1);
      }
    };
    walk(topic.children, 0);
    return items;
  }

  protected readonly topic = computed<TopicCardV2 | null>(() => {
    const selection = this.store.selection();
    return selection ? (this.store.topicById(selection.topicId) ?? null) : null;
  });

  /**
   * Card selection of a non-topic card (note / charts card). Keeping a
   * section for every selectable thing preserves the invariant that a card
   * showing its focus bar always has something to edit in this panel.
   */
  protected readonly cardContext = computed<NoteCardV2 | ChartCardV2 | null>(() => {
    const selection = this.store.selection();
    if (selection?.kind !== 'card') {
      return null;
    }
    const card = this.store.cardById(selection.topicId);
    return card && card.kind !== 'topic' ? card : null;
  });

  protected chartCardSource(card: ChartCardV2): TopicCardV2 | null {
    return this.store.topicById(card.sourceTopicId) ?? null;
  }

  protected readonly node = computed<NodeV2 | null>(() => {
    const selection = this.store.selection();
    const topic = this.topic();
    if (!topic || selection?.kind !== 'node') {
      return null;
    }
    return findNodeAndParent(topic.children, selection.nodeId)?.node ?? null;
  });

  protected readonly column = computed<ColumnV2 | null>(() => {
    const selection = this.store.selection();
    const topic = this.topic();
    if (!topic || selection?.kind !== 'column') {
      return null;
    }
    return topic.columns.find((candidate) => candidate.id === selection.columnId) ?? null;
  });

  protected readonly cellContext = computed<{ node: NodeV2; column: ColumnV2 } | null>(() => {
    const selection = this.store.selection();
    const topic = this.topic();
    if (!topic || selection?.kind !== 'cell') {
      return null;
    }
    const node = findNodeAndParent(topic.children, selection.nodeId)?.node;
    const column = topic.columns.find((candidate) => candidate.id === selection.columnId);
    return node && column ? { node, column } : null;
  });

  protected swatchClass(color: AccentColor): string {
    return SWATCH_BY_ACCENT[color];
  }

  protected canPasteCells(): boolean {
    return this.store.clipboard()?.kind === 'cells';
  }

  protected blurTarget(event: Event): void {
    event.preventDefault();
    (event.target as HTMLElement | null)?.blur();
  }

  protected commitCardTitle(topic: TopicCardV2, event: Event): void {
    this.store.setCardTitle(topic.id, (event.target as HTMLInputElement).value);
  }

  protected commitCardName(topic: TopicCardV2, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value.trim().length > 0 && value !== topic.displayName) {
      this.store.renameCard(topic.id, value);
    }
  }

  protected commitNodeName(topic: TopicCardV2, node: NodeV2, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value.trim().length > 0 && value !== node.displayName) {
      this.store.renameNode(topic.id, node.id, value);
    }
  }

  protected commitColumnName(topic: TopicCardV2, column: ColumnV2, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value.trim().length > 0 && value !== column.displayName) {
      this.store.renameColumn(topic.id, column.id, value);
    }
  }

  protected commitRefName(target: RefNameTarget, event: Event): void {
    const input = event.target as HTMLInputElement;
    const result = this.store.setRefName(target, input.value);
    if (!result.ok) {
      this.refNameError.set(result.error ?? 'Invalid reference name.');
      return;
    }
    this.refNameError.set(null);
  }

  protected toggleShowRoot(topic: TopicCardV2, event: Event): void {
    this.store.setShowRoot(topic.id, (event.target as HTMLInputElement).checked);
  }

  protected toggleShowRowNumbers(topic: TopicCardV2, event: Event): void {
    this.store.setShowRowNumbers(topic.id, (event.target as HTMLInputElement).checked);
  }

  protected commitCardDimension(
    topic: TopicCardV2,
    dimension: 'width' | 'height',
    event: Event,
  ): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const parsed = raw.length > 0 ? Number(raw) : null;
    const value = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    this.store.setCardSize(topic.id, { [dimension]: value });
  }

  protected toggleCardAutoExpand(topic: TopicCardV2, event: Event): void {
    this.store.setCardAutoExpand(topic.id, (event.target as HTMLInputElement).checked);
  }

  protected commitColumnWidth(topic: TopicCardV2, column: ColumnV2, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const parsed = raw.length > 0 ? Number(raw) : null;
    this.store.setColumnWidth(
      topic.id,
      column.id,
      parsed !== null && Number.isFinite(parsed) ? parsed : null,
    );
  }

  protected toggleFormatThousands(topic: TopicCardV2, column: ColumnV2, event: Event): void {
    this.store.setColumnNumberFormat(topic.id, column.id, {
      thousands: (event.target as HTMLInputElement).checked,
    });
  }

  protected commitFormatDecimals(topic: TopicCardV2, column: ColumnV2, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const parsed = raw.length > 0 ? Number(raw) : null;
    this.store.setColumnNumberFormat(topic.id, column.id, {
      decimals: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    });
  }

  protected commitRowHeight(topic: TopicCardV2, node: NodeV2, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const parsed = raw.length > 0 ? Number(raw) : null;
    this.store.setRowHeight(
      topic.id,
      node.id,
      parsed !== null && Number.isFinite(parsed) ? parsed : null,
    );
  }

  protected visibleColumns(topic: TopicCardV2): ColumnV2[] {
    return topic.columns.filter((column) => column.hidden !== true);
  }

  protected hiddenColumns(topic: TopicCardV2): ColumnV2[] {
    return topic.columns.filter((column) => column.hidden === true);
  }

  /** Re-syncing derives the Reference Name from the display name in one step. */
  protected toggleRefSync(target: RefNameTarget, event: Event): void {
    const synced = (event.target as HTMLInputElement).checked;
    const result = this.store.setRefNameSync(target, synced);
    this.refNameError.set(result.ok ? null : (result.error ?? 'Invalid reference name.'));
  }

  /**
   * Formula → Value is destructive (the formula is gone once the session's
   * undo history is), so it asks first; the store then freezes the current
   * results into the cells as one undo step.
   */
  protected requestValueKind(topic: TopicCardV2, column: ColumnV2): void {
    if (column.kind !== 'computed') {
      this.store.setColumnKind(topic.id, column.id, 'input');
      return;
    }
    this.pendingFormulaToValue.set({
      topicId: topic.id,
      columnId: column.id,
      displayName: column.displayName,
      expression: column.expression ?? '=',
    });
  }

  protected formulaToValueMessage(): string {
    const pending = this.pendingFormulaToValue();
    if (!pending) {
      return '';
    }
    return `“${pending.displayName}” keeps its current results as plain values, and its formula ${pending.expression} is removed. Undo can bring the formula back during this session only.`;
  }

  protected confirmFormulaToValue(): void {
    const pending = this.pendingFormulaToValue();
    if (pending) {
      this.store.setColumnKind(pending.topicId, pending.columnId, 'input');
    }
    this.pendingFormulaToValue.set(null);
  }

  /**
   * While the formula field is focused it owns ref insertion: lattices
   * highlight target columns and clicking one splices its Reference Name in
   * at the caret (clicks never blur this field — see lattice tryInsertRef).
   */
  protected beginFormulaSession(topic: TopicCardV2, column: ColumnV2, event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    this.formulaSession = {
      topicId: topic.id,
      columnId: column.id,
      insertRef: (refText) => insertReferenceIntoInput(input, refText),
    };
    this.store.setFormulaEditor(this.formulaSession);
    this.suggest.attach(topic.id, input);
  }

  protected onFormulaEnter(event: Event): void {
    if (this.suggest.accept()) {
      event.preventDefault();
      return;
    }
    this.blurTarget(event);
  }

  protected onFormulaEscape(event: Event): void {
    if (this.suggest.closeIfOpen()) {
      event.preventDefault();
      event.stopPropagation();
    }
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
  protected onFormulaKeyup(event: KeyboardEvent): void {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      this.suggest.refresh();
    }
  }

  protected commitExpression(topic: TopicCardV2, column: ColumnV2, event: Event): void {
    this.suggest.detach();
    if (this.formulaSession) {
      this.store.clearFormulaEditor(this.formulaSession);
      this.formulaSession = null;
    }
    const input = event.target as HTMLInputElement;
    let value = input.value.trim();
    if (value.length === 0) {
      input.value = column.expression ?? '=';
      return;
    }
    if (!value.startsWith('=')) {
      value = `= ${value}`;
    }
    if (value !== column.expression) {
      this.store.setColumnExpression(topic.id, column.id, value);
    }
  }

  protected commitChartSource(topic: TopicCardV2, column: ColumnV2, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value) {
      this.store.setColumnChart(topic.id, column.id, value);
    }
  }

  protected cellRawOf(context: { node: NodeV2; column: ColumnV2 }): string {
    return context.node.values[context.column.id] ?? '';
  }

  protected commitCellValue(
    topic: TopicCardV2,
    context: { node: NodeV2; column: ColumnV2 },
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement).value;
    if (value !== (context.node.values[context.column.id] ?? '')) {
      this.store.setCellValue(topic.id, context.node.id, context.column.id, value);
    }
  }

  protected commitRollup(topic: TopicCardV2, column: ColumnV2, event: Event): void {
    const mode = (event.target as HTMLSelectElement).value as RollupMode;
    this.store.setColumnRollup(topic.id, column.id, mode);
  }

  /** Non-chart columns spanned by the current range selection (visible order). */
  protected readonly rangeColumns = computed<ColumnV2[]>(() => {
    const selection = this.store.selection();
    const topic = this.topic();
    if (!topic || selection?.kind !== 'range') {
      return [];
    }
    const visible = topic.columns.filter((column) => column.hidden !== true);
    const anchorIndex = visible.findIndex((column) => column.id === selection.anchor.columnId);
    const focusIndex = visible.findIndex((column) => column.id === selection.focus.columnId);
    if (anchorIndex < 0 || focusIndex < 0) {
      return [];
    }
    const [start, end] =
      anchorIndex <= focusIndex ? [anchorIndex, focusIndex] : [focusIndex, anchorIndex];
    return visible.slice(start, end + 1).filter((column) => column.kind !== 'chart');
  });

  /** The shared Summary of the spanned columns, or '' when they disagree. */
  protected rangeRollupValue(): string {
    const columns = this.rangeColumns();
    const first = columns[0]?.rollup ?? 'none';
    return columns.every((column) => column.rollup === first) ? first : '';
  }

  protected commitRangeRollup(topic: TopicCardV2, event: Event): void {
    const mode = (event.target as HTMLSelectElement).value as RollupMode;
    this.store.setColumnsRollup(
      topic.id,
      this.rangeColumns().map((column) => column.id),
      mode,
    );
  }

  protected chartSourceOptions(topic: TopicCardV2, column: ColumnV2): ColumnV2[] {
    return topic.columns.filter(
      (candidate) => candidate.id !== column.id && candidate.kind !== 'chart',
    );
  }

  protected deleteColumn(topic: TopicCardV2, column: ColumnV2): void {
    const result = this.store.deleteColumn(topic.id, column.id);
    if (result && !result.ok && result.error) {
      this.notify.emit(result.error);
    }
  }
}
