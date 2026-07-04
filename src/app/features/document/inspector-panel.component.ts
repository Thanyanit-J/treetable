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
  ColumnV2,
  NodeV2,
  TopicCardV2,
  findNodeAndParent,
} from '../../core/model/document.model';
import {
  DocumentStoreService,
  FormulaEditorSession,
  RefNameTarget,
} from '../../core/store/document-store.service';
import { insertReferenceIntoInput } from './formula-ref-insert';
import { ConfirmDialogComponent } from './ui/confirm-dialog.component';

const SWATCH_BY_ACCENT: Record<AccentColor, string> = {
  sky: 'bg-sky-400',
  amber: 'bg-amber-400',
  emerald: 'bg-emerald-400',
  rose: 'bg-rose-400',
  violet: 'bg-violet-400',
  slate: 'bg-slate-400',
};

/**
 * The Inspector (CONTEXT.md): detailed editing for the current selection.
 * Everything too rich for a context menu lives here — names, Reference
 * Names, column types (value / formula / chart), accents, card layout.
 */
@Component({
  selector: 'app-inspector-panel',
  imports: [ConfirmDialogComponent],
  template: `
    @if (collapsed()) {
      <aside
        class="flex w-8 shrink-0 flex-col items-center border-l border-slate-200 bg-white pt-2"
      >
        <button
          type="button"
          class="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-600"
          aria-label="Expand inspector"
          (click)="collapsed.set(false)"
        >
          ◀
        </button>
      </aside>
    } @else {
      <aside
        class="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white"
        aria-label="Inspector"
      >
        <div class="flex items-center justify-between border-b border-slate-200 px-3 py-1.5">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-slate-400">Inspector</h2>
          <button
            type="button"
            class="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-600"
            aria-label="Collapse inspector"
            (click)="collapsed.set(true)"
          >
            ▶
          </button>
        </div>

        <div class="flex-1 space-y-4 p-3">
          @if (topic(); as topic) {
            @switch (selectionKind()) {
              @case ('card') {
                <p class="section-label">Topic</p>
                <label class="field">
                  <span>Name</span>
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
                    [attr.aria-invalid]="refNameError() ? 'true' : null"
                    (blur)="
                      commitRefName(
                        { kind: 'topic', topicId: topic.id, entityId: topic.id },
                        $event
                      )
                    "
                    (keydown.enter)="blurTarget($event)"
                  />
                </label>
                <fieldset class="field">
                  <legend>Tree layout</legend>
                  <div class="flex gap-1">
                    <button
                      type="button"
                      class="choice"
                      [class.choice-active]="(topic.pillAlignment ?? 'center') === 'center'"
                      (click)="store.setPillAlignment(topic.id, 'center')"
                    >
                      Middle
                    </button>
                    <button
                      type="button"
                      class="choice"
                      [class.choice-active]="topic.pillAlignment === 'top'"
                      (click)="store.setPillAlignment(topic.id, 'top')"
                    >
                      Top-down
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
                      [attr.aria-invalid]="refNameError() ? 'true' : null"
                      (blur)="
                        commitRefName(
                          { kind: 'node', topicId: topic.id, entityId: node.id },
                          $event
                        )
                      "
                      (keydown.enter)="blurTarget($event)"
                    />
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
                      <button
                        type="button"
                        class="choice"
                        [class.choice-active]="column.kind === 'chart'"
                        [disabled]="!hasChartSourceCandidate(topic, column)"
                        (click)="store.setColumnKind(topic.id, column.id, 'chart')"
                      >
                        Chart
                      </button>
                    </div>
                  </fieldset>
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
                          (blur)="commitExpression(topic, column, $event)"
                          (keydown.enter)="blurTarget($event)"
                        />
                        <span class="mt-1 block text-[11px] font-normal text-slate-400">
                          Click a column in any card to insert its reference.
                        </span>
                      </label>
                    }
                    @case ('chart') {
                      <label class="field">
                        <span>Bar chart of</span>
                        <select
                          class="field-input"
                          [value]="column.chartSource ?? ''"
                          (change)="commitChartSource(topic, column, $event)"
                        >
                          @for (option of chartSourceOptions(topic, column); track option.id) {
                            <option [value]="option.refName">{{ option.displayName }}</option>
                          }
                        </select>
                      </label>
                    }
                  }
                  @if (column.kind !== 'chart') {
                    <label class="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        [checked]="column.rollup === 'sum'"
                        (change)="toggleRollup(topic, column, $event)"
                      />
                      Sum rollup (footer + collapsed rows)
                    </label>
                  }
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
                  @if (context.column.kind === 'input') {
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
                      Computed by the column formula — edit it in the column settings.
                    </p>
                  }
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
              }
            }
            @if (refNameError(); as message) {
              <p class="text-xs text-rose-600" role="alert">{{ message }}</p>
            }
          } @else {
            <p class="text-sm text-slate-400">
              Select a topic, node, column or cell to edit its details here.
            </p>
          }
        </div>
      </aside>
    }

    <app-confirm-dialog
      [open]="pendingFormulaToValue() !== null"
      title="Convert formula to values"
      [message]="formulaToValueMessage()"
      confirmLabel="Convert to values"
      (confirmed)="confirmFormulaToValue()"
      (cancelled)="pendingFormulaToValue.set(null)"
    />
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
export class InspectorPanelComponent {
  protected readonly store = inject(DocumentStoreService);

  readonly requestDeleteTopic = output<string>();
  readonly requestDeleteNode = output<{ topicId: string; nodeId: string }>();
  readonly notify = output<string>();

  protected readonly collapsed = signal(false);
  protected readonly accentColors = ACCENT_COLORS;
  protected readonly refNameError = signal<string | null>(null);
  private formulaSession: FormulaEditorSession | null = null;

  /** Formula column awaiting the destructive convert-to-values confirmation. */
  protected readonly pendingFormulaToValue = signal<{
    topicId: string;
    columnId: string;
    displayName: string;
    expression: string;
  } | null>(null);

  protected readonly selectionKind = computed(() => this.store.selection()?.kind ?? null);

  protected readonly topic = computed<TopicCardV2 | null>(() => {
    const selection = this.store.selection();
    return selection ? (this.store.topicById(selection.topicId) ?? null) : null;
  });

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
  }

  protected commitExpression(topic: TopicCardV2, column: ColumnV2, event: Event): void {
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

  protected toggleRollup(topic: TopicCardV2, column: ColumnV2, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.store.setColumnRollup(topic.id, column.id, checked ? 'sum' : 'none');
  }

  protected chartSourceOptions(topic: TopicCardV2, column: ColumnV2): ColumnV2[] {
    return topic.columns.filter(
      (candidate) => candidate.id !== column.id && candidate.kind !== 'chart',
    );
  }

  protected hasChartSourceCandidate(topic: TopicCardV2, column: ColumnV2): boolean {
    return this.chartSourceOptions(topic, column).length > 0;
  }

  protected deleteColumn(topic: TopicCardV2, column: ColumnV2): void {
    const result = this.store.deleteColumn(topic.id, column.id);
    if (result && !result.ok && result.error) {
      this.notify.emit(result.error);
    }
  }
}
