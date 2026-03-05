import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CellValue, TreeTopic } from '../models/tree-table.model';
import { collectLeaves } from '../utils/tree-helpers';
import { ColumnContextMenuComponent } from './column-context-menu.component';
import { acquireMenuScrollLock, releaseMenuScrollLock } from '../utils/menu-scroll-lock';

@Component({
  selector: 'app-subtopic-table',
  imports: [FormsModule, ColumnContextMenuComponent],
  host: {
    '(pointerdown)': 'onHostPointerDown($event)',
    '(mousedown)': 'onHostMouseDown($event)',
    '(touchstart)': 'onHostTouchStart($event)',
    '(dragstart)': 'onHostDragStart($event)',
    '(document:mousedown)': 'onDocumentMouseDown($event)',
    '(document:tree-graph-menu-opened)': 'onGlobalMenuOpened($event)',
  },
  template: `
    <section #tableSection class="h-fit p-0" aria-label="Node table">
      <div #tableContainer class="overflow-auto">
        @if (rows().length === 0) {
          <div class="rounded-lg border border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
            No nodes yet. Add one in the tree graph.
          </div>
        } @else {
          <table class="mt-(--subtopic-table-offset-top) w-max border-collapse text-sm">
            <thead>
              <tr>
                @for (column of columns(); track column.id) {
                  <th
                    scope="col"
                    class="border border-slate-200 bg-slate-100 p-0 text-center font-semibold text-slate-700"
                    [style.width.ch]="columnWidthsCh()[column.id]"
                    [style.min-width.ch]="columnWidthsCh()[column.id]"
                    [class.border-sky-400]="activeReferencedColumnId() === column.id"
                    (contextmenu)="openMenu($event, column.id)"
                    (mousedown)="onColumnAssistMouseDown($event, column.id, null, null)"
                    (click)="onColumnAssistClick($event, column.id, null, null)"
                  >
                    <input
                      [attr.data-column-rename-id]="column.id"
                      [ngModel]="columnInputValue(column.id, column.name)"
                      (focus)="onHeaderInputFocus(column.id, column.name, $event)"
                      (ngModelChange)="onHeaderInputChange(column.id, $event)"
                      (blur)="onColumnRenameBlur(column.id)"
                      (keydown.enter)="onColumnRenameEnter($event, column.id)"
                      (keydown.escape)="onColumnRenameEscape($event, column.id, column.name)"
                      (mousedown)="onHeaderLabelMouseDown($event, column.id)"
                      (click)="onHeaderLabelClick($event, column.id)"
                      class="block min-h-(--subtopic-table-header-height) w-full rounded-none border-0 bg-transparent px-2 py-2 text-center text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500"
                      [attr.aria-label]="'Rename column ' + column.name"
                    />
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr
                  [class.bg-sky-50]="selectedNodeId() === row.id"
                  [class.outline]="selectedNodeId() === row.id"
                  [class.outline-2]="selectedNodeId() === row.id"
                  [class.outline-sky-300]="selectedNodeId() === row.id"
                >
                  @for (column of columns(); track column.id) {
                    @let cell = row.cells[column.id];
                    <td
                      class="border border-slate-200 p-0 align-top"
                      [class.border-sky-400]="activeReferencedColumnId() === column.id"
                      (contextmenu)="openMenu($event, column.id)"
                      (mousedown)="onColumnAssistMouseDown($event, column.id, row.id, column.id)"
                      (click)="onColumnAssistClick($event, column.id, row.id, column.id)"
                    >
                      <input
                        [attr.data-cell-key]="makeCellKey(row.id, column.id)"
                        [ngModel]="cellInputValue(row.id, column.id, cell?.raw ?? '', cell?.value ?? null, cell?.error ?? null)"
                        (focus)="onCellFocus(row.id, column.id)"
                        (blur)="onCellBlur($event, row.id, column.id)"
                        (click)="onFormulaCursorChange(row.id, column.id, $event)"
                        (keyup)="onFormulaCursorChange(row.id, column.id, $event)"
                        (input)="onFormulaCursorChange(row.id, column.id, $event)"
                        (keydown.enter)="onCellEnter($event)"
                        (keydown.escape)="onCellEscape($event)"
                        (ngModelChange)="onCellModelChange(row.id, column.id, $event)"
                        [attr.aria-label]="'Edit cell ' + column.name"
                        [attr.aria-invalid]="cell?.error ? 'true' : 'false'"
                        class="block min-h-[calc(var(--subtopic-node-height)+var(--subtopic-gap)+1px)] min-w-0 w-full overflow-x-auto whitespace-nowrap rounded-none border-0 px-2 py-2 text-sm text-slate-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500"
                      />
                    </td>
                  }
                </tr>
              }
            </tbody>
            @if (hasAnySummary()) {
              <tfoot data-testid="summary-footer">
                <tr>
                  @for (column of columns(); track column.id; let columnIndex = $index) {
                    <td class="border-0 p-0 align-top">
                      @if (column.summaryMode === 'sum') {
                        <div
                          [attr.data-summary-column-id]="column.id"
                          class="mt-2 cursor-default border-y border-r border-slate-200 bg-white px-2 py-2 text-center text-sm font-semibold text-slate-700"
                          [class.border-l]="showSummaryLeftBorder(columnIndex)"
                          (contextmenu)="openMenu($event, column.id)"
                        >
                          {{ summaryDisplayValue(column.id) }}
                        </div>
                      }
                    </td>
                  }
                </tr>
              </tfoot>
            }
          </table>
        }
      </div>

      <app-column-context-menu
        [open]="menuOpen()"
        [x]="menuX()"
        [y]="menuY()"
        [canDelete]="columns().length > 1"
        [summaryMode]="selectedColumnSummaryMode()"
        (action)="onMenuAction($event)"
        (menuClosed)="closeMenu()"
      />
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubtopicTableComponent {
  readonly topic = input.required<TreeTopic>();
  readonly selectedNodeId = input<string | null>(null);

  readonly setCell = output<{ topicId: string; nodeId: string; columnId: string; raw: string }>();
  readonly setColumnSummary = output<{ topicId: string; columnId: string; mode: 'none' | 'sum' }>();
  readonly selectNode = output<string | null>();
  readonly insertColumn = output<{ topicId: string; referenceColumnId: string; side: 'left' | 'right' }>();
  readonly deleteColumn = output<{ topicId: string; columnId: string }>();
  readonly renameColumn = output<{ topicId: string; columnId: string; name: string }>();

  protected readonly menuOpen = signal(false);
  protected readonly menuX = signal(0);
  protected readonly menuY = signal(0);
  protected readonly menuColumnId = signal<string | null>(null);
  protected readonly editingColumnId = signal<string | null>(null);
  protected readonly editingColumnName = signal('');
  protected readonly editingCellKey = signal<string | null>(null);
  protected readonly editingCellNodeId = signal<string | null>(null);
  protected readonly editingCellColumnId = signal<string | null>(null);
  protected readonly editingCellDraft = signal('');
  protected readonly formulaEditingMode = signal(false);
  protected readonly activeReferencedColumnId = signal<string | null>(null);
  protected readonly columns = computed(() => this.topic().columns);
  protected readonly rows = computed(() => collectLeaves(this.topic().children));
  protected readonly hasAnySummary = computed(() => this.columns().some((column) => column.summaryMode === 'sum'));
  protected readonly selectedColumnSummaryMode = computed<'none' | 'sum'>(() => {
    const columnId = this.menuColumnId();
    const column = this.columns().find((candidate) => candidate.id === columnId);
    return column?.summaryMode === 'sum' ? 'sum' : 'none';
  });
  protected readonly columnWidthsCh = computed(() => {
    const widths: Record<string, number> = {};
    for (const column of this.columns()) {
      let maxLength = Math.max(10, column.name.length + 2);
      for (const row of this.rows()) {
        const cell = row.cells[column.id];
        const visible = this.cellInputValue(
          row.id,
          column.id,
          cell?.raw ?? '',
          cell?.value ?? null,
          cell?.error ?? null,
        );
        maxLength = Math.max(maxLength, visible.length + 2);
      }
      widths[column.id] = Math.min(maxLength, 56);
    }
    return widths;
  });

  private readonly tableContainerRef = viewChild<ElementRef<HTMLElement>>('tableContainer');
  private readonly tableSectionRef = viewChild<ElementRef<HTMLElement>>('tableSection');
  private readonly menuOwnerId = `subtopic-table-${crypto.randomUUID()}`;
  private isScrollLocked = false;

  openMenu(event: MouseEvent, columnId: string): void {
    event.preventDefault();
    this.menuColumnId.set(columnId);
    this.menuX.set(event.clientX);
    this.menuY.set(event.clientY);
    this.menuOpen.set(true);
    this.ensureScrollLock();
    this.broadcastMenuOpened();
  }

  openMenuFromButton(event: MouseEvent, columnId: string): void {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    this.menuColumnId.set(columnId);
    this.menuX.set(rect.left);
    this.menuY.set(rect.bottom + 4);
    this.menuOpen.set(true);
    this.ensureScrollLock();
    this.broadcastMenuOpened();
  }

  selectColumn(columnId: string): void {
    this.menuColumnId.set(columnId);
  }

  protected onHeaderLabelMouseDown(event: MouseEvent, columnId: string): void {
    if (!this.formulaEditingMode()) {
      return;
    }

    const editingColumnId = this.editingCellColumnId();
    if (editingColumnId === columnId) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
  }

  protected onHeaderLabelClick(event: MouseEvent, columnId: string): void {
    if (this.menuOpen()) {
      this.closeMenu();
    }

    if (this.formulaEditingMode()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.selectColumn(columnId);
  }

  onMenuAction(action: 'insertLeft' | 'insertRight' | 'rename' | 'delete' | 'toggleSummary'): void {
    const columnId = this.menuColumnId();
    if (!columnId) {
      this.closeMenu();
      return;
    }

    const topicId = this.topic().id;
    if (action === 'insertLeft') {
      this.insertColumn.emit({ topicId, referenceColumnId: columnId, side: 'left' });
      this.closeMenu();
      return;
    }

    if (action === 'insertRight') {
      this.insertColumn.emit({ topicId, referenceColumnId: columnId, side: 'right' });
      this.closeMenu();
      return;
    }

    if (action === 'delete') {
      this.deleteColumn.emit({ topicId, columnId });
      this.closeMenu();
      return;
    }

    if (action === 'toggleSummary') {
      const column = this.columns().find((candidate) => candidate.id === columnId);
      const nextMode: 'none' | 'sum' = column?.summaryMode === 'sum' ? 'none' : 'sum';
      this.setColumnSummary.emit({ topicId, columnId, mode: nextMode });
      this.closeMenu();
      return;
    }

    const column = this.columns().find((candidate) => candidate.id === columnId);
    this.startColumnRename(columnId, column?.name ?? '');
    this.closeMenu();
  }

  closeMenu(): void {
    this.releaseScrollLock();
    this.menuOpen.set(false);
  }

  startEditingCell(nodeId: string, columnId: string): void {
    if (this.isEditingCell(nodeId, columnId)) {
      return;
    }

    const raw = this.getCellRaw(nodeId, columnId);
    this.editingCellKey.set(this.makeCellKey(nodeId, columnId));
    this.editingCellNodeId.set(nodeId);
    this.editingCellColumnId.set(columnId);
    this.editingCellDraft.set(raw);
    this.formulaEditingMode.set(raw.trim().startsWith('='));
    this.activeReferencedColumnId.set(null);
  }

  commitEditingCell(): void {
    const nodeId = this.editingCellNodeId();
    const columnId = this.editingCellColumnId();
    if (nodeId && columnId) {
      this.setCell.emit({
        topicId: this.topic().id,
        nodeId,
        columnId,
        raw: this.editingCellDraft(),
      });
    }

    this.resetEditingState();
  }

  cancelEditingCell(event?: Event): void {
    const nodeId = this.editingCellNodeId();
    const columnId = this.editingCellColumnId();

    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    this.resetEditingState();
    if (nodeId && columnId) {
      this.syncDisplayValue(nodeId, columnId);
    }
  }

  isEditingCell(nodeId: string, columnId: string): boolean {
    return this.editingCellKey() === this.makeCellKey(nodeId, columnId);
  }

  displayCellValue(raw: string, value: CellValue, error: string | null): string {
    if (error) {
      return error;
    }

    if (raw.trim().startsWith('=')) {
      return this.formatValue(value);
    }

    if (raw.trim().length === 0) {
      return '—';
    }

    return raw;
  }

  protected summaryDisplayValue(columnId: string): string {
    const column = this.columns().find((candidate) => candidate.id === columnId);
    if (column?.summaryMode !== 'sum') {
      return '';
    }

    if (column.type === 'text') {
      return 'N/A';
    }

    let total = 0;
    for (const row of this.rows()) {
      const cell = row.cells[columnId];
      if (cell?.error) {
        return cell.error;
      }

      if (this.isInvalidSummaryLiteral(cell?.raw ?? '')) {
        return 'N/A';
      }

      const value = cell?.value;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 'N/A';
      }
      total += value;
    }

    return this.formatValue(total);
  }

  protected showSummaryLeftBorder(columnIndex: number): boolean {
    const columns = this.columns();
    const current = columns[columnIndex];
    if (current?.summaryMode !== 'sum') {
      return false;
    }

    if (columnIndex === 0) {
      return true;
    }

    const previous = columns[columnIndex - 1];
    return previous?.summaryMode !== 'sum';
  }

  private isInvalidSummaryLiteral(raw: string): boolean {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith('=')) {
      return false;
    }

    const parsed = Number(trimmed);
    return Number.isNaN(parsed) || !Number.isFinite(parsed);
  }

  protected startColumnRename(columnId: string, currentName: string): void {
    this.editingColumnId.set(columnId);
    this.editingColumnName.set(currentName);
    queueMicrotask(() => {
      const input = this.getColumnRenameInput(columnId);
      if (!input) {
        return;
      }
      input.focus();
      input.select();
    });
  }

  protected commitColumnRename(columnId: string): void {
    if (this.editingColumnId() !== columnId) {
      return;
    }
    const nextName = this.editingColumnName().trim();
    if (nextName.length > 0) {
      this.renameColumn.emit({ topicId: this.topic().id, columnId, name: nextName });
    }
    this.editingColumnId.set(null);
    this.editingColumnName.set('');
  }

  protected onColumnRenameBlur(columnId: string): void {
    this.commitColumnRename(columnId);
  }

  protected onColumnRenameEnter(event: Event, columnId: string): void {
    event.preventDefault();
    this.commitColumnRename(columnId);
    const input = event.target as HTMLInputElement | null;
    input?.blur();
  }

  protected onColumnRenameEscape(event: Event, columnId: string, originalName: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.editingColumnId() !== columnId) {
      return;
    }
    this.editingColumnId.set(null);
    this.editingColumnName.set('');
    const input = event.target as HTMLInputElement | null;
    if (input) {
      input.value = originalName;
      input.blur();
    }
  }

  protected onHeaderInputFocus(columnId: string, currentName: string, event: FocusEvent): void {
    if (this.menuOpen()) {
      this.closeMenu();
    }

    if (this.formulaEditingMode()) {
      return;
    }

    if (this.editingColumnId() === columnId) {
      return;
    }

    const previousEditingId = this.editingColumnId();
    if (previousEditingId && previousEditingId !== columnId) {
      this.commitColumnRename(previousEditingId);
    }

    this.editingColumnId.set(columnId);
    this.editingColumnName.set(currentName);
  }

  protected onHeaderInputChange(columnId: string, value: string): void {
    if (this.editingColumnId() !== columnId) {
      return;
    }

    this.editingColumnName.set(value);
  }

  protected columnInputValue(columnId: string, currentName: string): string {
    if (this.editingColumnId() === columnId) {
      return this.editingColumnName();
    }

    if (this.formulaEditingMode()) {
      return columnId;
    }

    return currentName;
  }

  protected onColumnAssistMouseDown(
    event: MouseEvent,
    clickedColumnId: string,
    clickedNodeId: string | null,
    clickedCellColumnId: string | null,
  ): void {
    if (!this.formulaEditingMode()) {
      return;
    }

    if (
      clickedNodeId === this.editingCellNodeId() &&
      clickedCellColumnId === this.editingCellColumnId()
    ) {
      return;
    }

    const editingColumnId = this.editingCellColumnId();
    if (editingColumnId && clickedColumnId === editingColumnId) {
      if (clickedNodeId && clickedNodeId !== this.editingCellNodeId()) {
        this.commitEditingCell();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.insertColumnReference(clickedColumnId);
  }

  protected onCellFocus(nodeId: string, columnId: string): void {
    if (this.menuOpen()) {
      this.closeMenu();
    }

    this.selectNode.emit(nodeId);
    if (this.isEditingCell(nodeId, columnId)) {
      return;
    }

    this.startEditingCell(nodeId, columnId);
  }

  protected onColumnAssistClick(
    event: MouseEvent,
    clickedColumnId: string,
    clickedNodeId: string | null,
    clickedCellColumnId: string | null,
  ): void {
    if (this.menuOpen()) {
      this.closeMenu();
    }

    if (!this.formulaEditingMode()) {
      return;
    }

    if (
      clickedNodeId === this.editingCellNodeId() &&
      clickedCellColumnId === this.editingCellColumnId()
    ) {
      return;
    }

    const editingColumnId = this.editingCellColumnId();
    if (editingColumnId && clickedColumnId === editingColumnId) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  protected onCellBlur(event: FocusEvent, nodeId: string, columnId: string): void {
    if (!this.isEditingCell(nodeId, columnId)) {
      this.clearSelectionIfFocusLeftTable(event);
      return;
    }

    this.commitEditingCell();
    this.clearSelectionIfFocusLeftTable(event);
  }

  protected onCellEnter(event: Event): void {
    event.preventDefault();
    if (!this.isEditingAnyCell()) {
      return;
    }

    this.commitEditingCell();
    const input = event.target as HTMLInputElement | null;
    input?.blur();
  }

  protected onCellEscape(event: Event): void {
    this.cancelEditingCell(event);
    const input = event.target as HTMLInputElement | null;
    input?.blur();
  }

  protected onCellModelChange(nodeId: string, columnId: string, raw: string): void {
    if (!this.isEditingCell(nodeId, columnId)) {
      return;
    }

    this.editingCellDraft.set(raw);
    this.formulaEditingMode.set(raw.trim().startsWith('='));
    if (!raw.trim().startsWith('=')) {
      this.activeReferencedColumnId.set(null);
    }
  }

  protected onFormulaCursorChange(nodeId: string, columnId: string, event: Event): void {
    if (!this.isEditingCell(nodeId, columnId)) {
      return;
    }

    if (!this.formulaEditingMode()) {
      this.activeReferencedColumnId.set(null);
      return;
    }

    const input = event.target as HTMLInputElement;
    const raw = input.value;
    const cursor = input.selectionStart ?? raw.length;
    this.activeReferencedColumnId.set(this.findReferencedColumnAtCursor(raw, cursor));
  }

  protected onDocumentMouseDown(event: MouseEvent): void {
    const section = this.tableSectionRef()?.nativeElement;
    const target = event.target as Node | null;
    if (section && target && !section.contains(target)) {
      this.selectNode.emit(null);
      this.activeReferencedColumnId.set(null);
    }

    if (!this.isEditingAnyCell()) {
      return;
    }

    const table = this.tableContainerRef()?.nativeElement;
    if (!table || !target) {
      this.commitEditingCell();
      return;
    }

    if (!table.contains(target)) {
      this.commitEditingCell();
    }
  }

  protected onHostPointerDown(event: PointerEvent): void {
    event.stopPropagation();
  }

  protected onHostMouseDown(event: MouseEvent): void {
    event.stopPropagation();
  }

  protected onHostTouchStart(event: TouchEvent): void {
    event.stopPropagation();
  }

  protected onHostDragStart(event: DragEvent): void {
    event.stopPropagation();
  }

  protected onGlobalMenuOpened(event: Event): void {
    if (!this.menuOpen()) {
      return;
    }

    const ownerId = (event as CustomEvent<{ ownerId?: string }>).detail?.ownerId;
    if (!ownerId || ownerId === this.menuOwnerId) {
      return;
    }

    this.closeMenu();
  }

  protected cellInputValue(
    nodeId: string,
    columnId: string,
    raw: string,
    value: CellValue,
    error: string | null,
  ): string {
    if (this.isEditingCell(nodeId, columnId)) {
      return this.editingCellDraft();
    }

    return this.displayCellValue(raw, value, error);
  }

  protected makeCellKey(nodeId: string, columnId: string): string {
    return `${nodeId}:${columnId}`;
  }

  private formatValue(value: CellValue): string {
    if (value === null || value === '') {
      return '—';
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
    return String(value);
  }

  private isEditingAnyCell(): boolean {
    return this.editingCellKey() !== null;
  }

  private resetEditingState(): void {
    this.editingCellKey.set(null);
    this.editingCellNodeId.set(null);
    this.editingCellColumnId.set(null);
    this.editingCellDraft.set('');
    this.formulaEditingMode.set(false);
    this.activeReferencedColumnId.set(null);
  }

  private getCellRaw(nodeId: string, columnId: string): string {
    const row = this.rows().find((candidate) => candidate.id === nodeId);
    return row?.cells[columnId]?.raw ?? '';
  }

  private insertColumnReference(columnId: string): void {
    const nodeId = this.editingCellNodeId();
    const editingColumnId = this.editingCellColumnId();
    if (!nodeId || !editingColumnId) {
      return;
    }

    const cellKey = this.makeCellKey(nodeId, editingColumnId);
    const input = this.getInputElement(cellKey);
    if (!input) {
      return;
    }

    const current = this.editingCellDraft();
    const selectionStart = input.selectionStart ?? current.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    const range = this.getReferenceRangeAtCursor(current, selectionStart);
    const replaceStart = range ? range.start : selectionStart;
    const replaceEnd = range ? range.end : selectionEnd;
    const inserted = `${current.slice(0, replaceStart)}${columnId}${current.slice(replaceEnd)}`;

    this.editingCellDraft.set(inserted);
    this.formulaEditingMode.set(true);

    const nextCursor = replaceStart + columnId.length;
    this.scheduleCaretPosition(cellKey, nextCursor);
    this.activeReferencedColumnId.set(columnId);
  }

  private findReferencedColumnAtCursor(raw: string, cursor: number): string | null {
    if (!raw.trim().startsWith('=')) {
      return null;
    }

    const pattern = /\$[A-Za-z_]\w*/g;
    for (const match of raw.matchAll(pattern)) {
      const token = match[0];
      const start = match.index ?? -1;
      if (start < 0) {
        continue;
      }
      const end = start + token.length;
      if (cursor >= start && cursor <= end) {
        return token;
      }
    }

    return null;
  }

  private getReferenceRangeAtCursor(raw: string, cursor: number): { start: number; end: number } | null {
    const pattern = /\$[A-Za-z_]\w*/g;
    for (const match of raw.matchAll(pattern)) {
      const token = match[0];
      const start = match.index ?? -1;
      if (start < 0) {
        continue;
      }
      const end = start + token.length;
      if (cursor >= start && cursor <= end) {
        return { start, end };
      }
    }

    return null;
  }

  private setCaretPosition(cellKey: string, nextCursor: number): void {
    const input = this.getInputElement(cellKey);
    if (!input) {
      return;
    }

    input.focus();
    input.setSelectionRange(nextCursor, nextCursor);

    const textWidthFactor = 8;
    const targetScroll = Math.max(0, nextCursor * textWidthFactor - input.clientWidth / 2);
    input.scrollLeft = targetScroll;
  }

  private scheduleCaretPosition(cellKey: string, nextCursor: number): void {
    requestAnimationFrame(() => {
      this.setCaretPosition(cellKey, nextCursor);
    });
    setTimeout(() => {
      this.setCaretPosition(cellKey, nextCursor);
    }, 0);
  }

  private getInputElement(cellKey: string): HTMLInputElement | null {
    const tableRoot = this.tableContainerRef()?.nativeElement;
    return tableRoot?.querySelector<HTMLInputElement>(`input[data-cell-key="${cellKey}"]`) ?? null;
  }

  private getColumnRenameInput(columnId: string): HTMLInputElement | null {
    const tableRoot = this.tableContainerRef()?.nativeElement;
    return tableRoot?.querySelector<HTMLInputElement>(`input[data-column-rename-id="${columnId}"]`) ?? null;
  }

  private syncDisplayValue(nodeId: string, columnId: string): void {
    const cellKey = this.makeCellKey(nodeId, columnId);
    const input = this.getInputElement(cellKey);
    if (!input) {
      return;
    }

    const row = this.rows().find((candidate) => candidate.id === nodeId);
    const cell = row?.cells[columnId];
    input.value = this.displayCellValue(cell?.raw ?? '', cell?.value ?? null, cell?.error ?? null);
  }

  private clearSelectionIfFocusLeftTable(event: FocusEvent): void {
    const section = this.tableSectionRef()?.nativeElement;
    const relatedTarget = event.relatedTarget as Node | null;
    if (!section || (relatedTarget && section.contains(relatedTarget))) {
      return;
    }
    this.selectNode.emit(null);
    this.activeReferencedColumnId.set(null);
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
