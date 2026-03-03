import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TreeTopic } from '../models/tree-table.model';
import { ColumnContextMenuComponent } from './column-context-menu.component';

@Component({
  selector: 'app-subtopic-table',
  imports: [FormsModule, ColumnContextMenuComponent],
  host: {
    '(pointerdown)': 'onHostPointerDown($event)',
    '(mousedown)': 'onHostMouseDown($event)',
    '(touchstart)': 'onHostTouchStart($event)',
    '(dragstart)': 'onHostDragStart($event)',
    '(document:mousedown)': 'onDocumentMouseDown($event)',
  },
  template: `
    <section #tableSection class="h-full p-1" aria-label="Subtopic table">
      <div #tableContainer class="overflow-auto">
        @if (rows().length === 0) {
          <div class="rounded-lg border border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
            No subtopics yet. Add one in the tree graph.
          </div>
        } @else {
          <table class="w-max border-collapse text-sm">
            <thead>
              <tr>
                @for (column of columns(); track column.id) {
                  <th
                    scope="col"
                    class="border border-slate-200 bg-slate-100 px-2 py-2 text-left font-semibold text-slate-700"
                    [style.width.ch]="columnWidthsCh()[column.id]"
                    [style.min-width.ch]="columnWidthsCh()[column.id]"
                    [class.border-sky-400]="activeReferencedColumnId() === column.id"
                    (contextmenu)="openMenu($event, column.id)"
                    (mousedown)="onColumnAssistMouseDown($event, column.id, null, null)"
                    (click)="onColumnAssistClick($event, column.id, null, null)"
                  >
                    <div class="flex items-center gap-2">
                      @if (editingColumnId() === column.id) {
                        <input
                          [attr.data-column-rename-id]="column.id"
                          [ngModel]="editingColumnName()"
                          (ngModelChange)="editingColumnName.set($event)"
                          (blur)="onColumnRenameBlur(column.id)"
                          (keydown.enter)="onColumnRenameEnter($event, column.id)"
                          (keydown.escape)="onColumnRenameEscape($event, column.id)"
                          class="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                          [attr.aria-label]="'Rename column ' + column.name"
                        />
                      } @else {
                        <button
                          (dblclick)="startColumnRename(column.id, column.name)"
                          (mousedown)="onHeaderLabelMouseDown($event, column.id)"
                          (click)="onHeaderLabelClick($event, column.id)"
                          class="truncate text-left"
                          type="button"
                        >
                          {{ formulaEditingMode() ? column.id : column.name }}
                        </button>
                      }
                      <button
                        (click)="openMenuFromButton($event, column.id)"
                        class="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
                        [attr.aria-label]="'Open actions for column ' + column.name"
                        type="button"
                      >
                        ⋯
                      </button>
                    </div>
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
                        class="block min-h-[44px] min-w-0 w-full overflow-x-auto whitespace-nowrap rounded-none border-0 px-2 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-500"
                      />
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      <app-column-context-menu
        [open]="menuOpen()"
        [x]="menuX()"
        [y]="menuY()"
        [canDelete]="columns().length > 1"
        (action)="onMenuAction($event)"
        (close)="closeMenu()"
      />
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubtopicTableComponent {
  readonly topic = input.required<TreeTopic>();
  readonly selectedNodeId = input<string | null>(null);

  readonly setCell = output<{ topicId: string; subtopicId: string; columnId: string; raw: string }>();
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
  protected readonly rows = computed(() => this.topic().children);
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

  openMenu(event: MouseEvent, columnId: string): void {
    event.preventDefault();
    this.menuColumnId.set(columnId);
    this.menuX.set(event.clientX);
    this.menuY.set(event.clientY);
    this.menuOpen.set(true);
  }

  openMenuFromButton(event: MouseEvent, columnId: string): void {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    this.menuColumnId.set(columnId);
    this.menuX.set(rect.left);
    this.menuY.set(rect.bottom + 4);
    this.menuOpen.set(true);
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
    if (this.formulaEditingMode()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.selectColumn(columnId);
  }

  onMenuAction(action: 'insertLeft' | 'insertRight' | 'rename' | 'delete'): void {
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

    const column = this.columns().find((candidate) => candidate.id === columnId);
    this.startColumnRename(columnId, column?.name ?? '');
    this.closeMenu();
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  startEditingCell(subtopicId: string, columnId: string): void {
    if (this.isEditingCell(subtopicId, columnId)) {
      return;
    }

    const raw = this.getCellRaw(subtopicId, columnId);
    this.editingCellKey.set(this.makeCellKey(subtopicId, columnId));
    this.editingCellNodeId.set(subtopicId);
    this.editingCellColumnId.set(columnId);
    this.editingCellDraft.set(raw);
    this.formulaEditingMode.set(raw.trim().startsWith('='));
    this.activeReferencedColumnId.set(null);
  }

  commitEditingCell(): void {
    const subtopicId = this.editingCellNodeId();
    const columnId = this.editingCellColumnId();
    if (subtopicId && columnId) {
      this.setCell.emit({
        topicId: this.topic().id,
        subtopicId,
        columnId,
        raw: this.editingCellDraft(),
      });
    }

    this.resetEditingState();
  }

  cancelEditingCell(event?: Event): void {
    const subtopicId = this.editingCellNodeId();
    const columnId = this.editingCellColumnId();

    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    this.resetEditingState();
    if (subtopicId && columnId) {
      this.syncDisplayValue(subtopicId, columnId);
    }
  }

  isEditingCell(subtopicId: string, columnId: string): boolean {
    return this.editingCellKey() === this.makeCellKey(subtopicId, columnId);
  }

  displayCellValue(raw: string, value: number | string | null, error: string | null): string {
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

  protected startColumnRename(columnId: string, currentName: string): void {
    this.editingColumnId.set(columnId);
    this.editingColumnName.set(currentName);
    requestAnimationFrame(() => {
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
  }

  protected onColumnRenameEscape(event: Event, columnId: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.editingColumnId() !== columnId) {
      return;
    }
    this.editingColumnId.set(null);
    this.editingColumnName.set('');
  }

  protected onColumnAssistMouseDown(
    event: MouseEvent,
    clickedColumnId: string,
    clickedSubtopicId: string | null,
    clickedCellColumnId: string | null,
  ): void {
    if (!this.formulaEditingMode()) {
      return;
    }

    if (
      clickedSubtopicId === this.editingCellNodeId() &&
      clickedCellColumnId === this.editingCellColumnId()
    ) {
      return;
    }

    const editingColumnId = this.editingCellColumnId();
    if (editingColumnId && clickedColumnId === editingColumnId) {
      if (clickedSubtopicId && clickedSubtopicId !== this.editingCellNodeId()) {
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

  protected onCellFocus(subtopicId: string, columnId: string): void {
    this.selectNode.emit(subtopicId);
    if (this.isEditingCell(subtopicId, columnId)) {
      return;
    }

    this.startEditingCell(subtopicId, columnId);
  }

  protected onColumnAssistClick(
    event: MouseEvent,
    clickedColumnId: string,
    clickedSubtopicId: string | null,
    clickedCellColumnId: string | null,
  ): void {
    if (!this.formulaEditingMode()) {
      return;
    }

    if (
      clickedSubtopicId === this.editingCellNodeId() &&
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

  protected onCellBlur(event: FocusEvent, subtopicId: string, columnId: string): void {
    if (!this.isEditingCell(subtopicId, columnId)) {
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

  protected onCellModelChange(subtopicId: string, columnId: string, raw: string): void {
    if (!this.isEditingCell(subtopicId, columnId)) {
      return;
    }

    this.editingCellDraft.set(raw);
    this.formulaEditingMode.set(raw.trim().startsWith('='));
    if (!raw.trim().startsWith('=')) {
      this.activeReferencedColumnId.set(null);
    }
  }

  protected onFormulaCursorChange(subtopicId: string, columnId: string, event: Event): void {
    if (!this.isEditingCell(subtopicId, columnId)) {
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

  protected cellInputValue(
    subtopicId: string,
    columnId: string,
    raw: string,
    value: number | string | null,
    error: string | null,
  ): string {
    if (this.isEditingCell(subtopicId, columnId)) {
      return this.editingCellDraft();
    }

    return this.displayCellValue(raw, value, error);
  }

  protected makeCellKey(subtopicId: string, columnId: string): string {
    return `${subtopicId}:${columnId}`;
  }

  private formatValue(value: number | string | null): string {
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

  private getCellRaw(subtopicId: string, columnId: string): string {
    const row = this.rows().find((candidate) => candidate.id === subtopicId);
    return row?.cells[columnId]?.raw ?? '';
  }

  private insertColumnReference(columnId: string): void {
    const subtopicId = this.editingCellNodeId();
    const editingColumnId = this.editingCellColumnId();
    if (!subtopicId || !editingColumnId) {
      return;
    }

    const cellKey = this.makeCellKey(subtopicId, editingColumnId);
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

    const pattern = /\$[A-Za-z_][A-Za-z0-9_]*/g;
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
    const pattern = /\$[A-Za-z_][A-Za-z0-9_]*/g;
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

  private syncDisplayValue(subtopicId: string, columnId: string): void {
    const cellKey = this.makeCellKey(subtopicId, columnId);
    const input = this.getInputElement(cellKey);
    if (!input) {
      return;
    }

    const row = this.rows().find((candidate) => candidate.id === subtopicId);
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
}
