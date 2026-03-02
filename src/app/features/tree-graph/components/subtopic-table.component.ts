import { ChangeDetectionStrategy, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableColumn } from '../models/tree-table.model';
import { VisibleSubtopicRow } from '../services/tree-table-store.service';
import { ColumnContextMenuComponent } from './column-context-menu.component';

@Component({
  selector: 'app-subtopic-table',
  imports: [FormsModule, ColumnContextMenuComponent],
  host: {
    '(document:mousedown)': 'onDocumentMouseDown($event)',
  },
  template: `
    <section class="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm" aria-label="Subtopic table">
      <div class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Subtopic Table</div>

      <div #tableContainer class="overflow-auto">
        <table class="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              @for (column of columns(); track column.id) {
                <th
                  scope="col"
                  class="min-w-40 border border-slate-200 bg-slate-100 px-2 py-2 text-left font-semibold text-slate-700"
                  [class.border-sky-400]="activeReferencedColumnId() === column.id"
                  (contextmenu)="openMenu($event, column.id)"
                  (mousedown)="onColumnAssistMouseDown($event, column.id, null, null)"
                >
                  <div class="flex items-center gap-2">
                    @if (editingColumnId() === column.id) {
                      <input
                        [ngModel]="editingColumnName()"
                        (ngModelChange)="editingColumnName.set($event)"
                        (blur)="commitColumnRename(column.id)"
                        (keydown.enter)="commitColumnRename(column.id)"
                        class="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                        [attr.aria-label]="'Rename column ' + column.name"
                      />
                    } @else {
                      <button
                        (dblclick)="startColumnRename(column.id, column.name)"
                        (click)="selectColumn(column.id)"
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
            @for (row of rows(); track row.subtopic.id) {
              <tr
                [class.bg-sky-50]="selectedNodeId() === row.subtopic.id"
                [class.outline]="selectedNodeId() === row.subtopic.id"
                [class.outline-2]="selectedNodeId() === row.subtopic.id"
                [class.outline-sky-300]="selectedNodeId() === row.subtopic.id"
              >
                @for (column of columns(); track column.id) {
                  @let cell = row.subtopic.cells[column.id];
                  <td
                    class="border border-slate-200 px-2 py-2 align-top"
                    [class.border-sky-400]="activeReferencedColumnId() === column.id"
                    (contextmenu)="openMenu($event, column.id)"
                    (mousedown)="onColumnAssistMouseDown($event, column.id, row.subtopic.id, column.id)"
                  >
                    @if (isEditingCell(row.subtopic.id, column.id)) {
                      <input
                        #formulaInput
                        [attr.data-cell-key]="makeCellKey(row.subtopic.id, column.id)"
                        [ngModel]="cell?.raw ?? ''"
                        (focus)="selectNode.emit(row.subtopic.id)"
                        (blur)="stopEditingCell()"
                        (click)="onFormulaCursorChange($event)"
                        (keyup)="onFormulaCursorChange($event)"
                        (input)="onFormulaCursorChange($event)"
                        (keydown.enter)="stopEditingCell()"
                        (ngModelChange)="setCell.emit({ nodeId: row.subtopic.id, columnId: column.id, raw: $event })"
                        [attr.aria-invalid]="cell?.error ? 'true' : 'false'"
                        class="min-w-0 w-full overflow-x-auto whitespace-nowrap rounded border px-2 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500"
                        [class.border-rose-300]="!!cell?.error"
                        [class.border-slate-300]="!cell?.error"
                      />
                    } @else {
                      <button
                        (click)="onViewCellClick($event, row.subtopic.id, column.id)"
                        [attr.aria-label]="'Edit cell ' + column.name"
                        class="w-full truncate rounded border border-transparent px-2 py-1.5 text-left text-sm text-slate-700 hover:border-slate-200 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500"
                        type="button"
                      >
                        {{ displayCellValue(cell?.raw ?? '', cell?.value ?? null, cell?.error ?? null) }}
                      </button>
                    }
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td
                  [attr.colspan]="columns().length"
                  class="border border-slate-200 px-3 py-6 text-center text-sm text-slate-500"
                >
                  No visible subtopics. Add subtopics in the tree graph.
                </td>
              </tr>
            }
          </tbody>
        </table>
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
  readonly columns = input.required<TableColumn[]>();
  readonly rows = input.required<VisibleSubtopicRow[]>();
  readonly selectedNodeId = input<string | null>(null);

  readonly setCell = output<{ nodeId: string; columnId: string; raw: string }>();
  readonly selectNode = output<string | null>();
  readonly insertColumn = output<{ referenceColumnId: string; side: 'left' | 'right' }>();
  readonly deleteColumn = output<{ columnId: string }>();
  readonly renameColumn = output<{ columnId: string; name: string }>();

  protected readonly menuOpen = signal(false);
  protected readonly menuX = signal(0);
  protected readonly menuY = signal(0);
  protected readonly menuColumnId = signal<string | null>(null);
  protected readonly editingColumnId = signal<string | null>(null);
  protected readonly editingColumnName = signal('');
  protected readonly editingCellKey = signal<string | null>(null);
  protected readonly editingCellNodeId = signal<string | null>(null);
  protected readonly editingCellColumnId = signal<string | null>(null);
  protected readonly formulaEditingMode = signal(false);
  protected readonly activeReferencedColumnId = signal<string | null>(null);
  protected readonly keepEditingOnNextBlur = signal(false);

  private readonly tableContainerRef = viewChild<ElementRef<HTMLElement>>('tableContainer');
  private readonly formulaInputRef = viewChild<ElementRef<HTMLInputElement>>('formulaInput');

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

  onMenuAction(action: 'insertLeft' | 'insertRight' | 'rename' | 'delete'): void {
    const columnId = this.menuColumnId();
    if (!columnId) {
      this.closeMenu();
      return;
    }

    if (action === 'insertLeft') {
      this.insertColumn.emit({ referenceColumnId: columnId, side: 'left' });
      this.closeMenu();
      return;
    }

    if (action === 'insertRight') {
      this.insertColumn.emit({ referenceColumnId: columnId, side: 'right' });
      this.closeMenu();
      return;
    }

    if (action === 'delete') {
      this.deleteColumn.emit({ columnId });
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

  startEditingCell(nodeId: string, columnId: string): void {
    const row = this.rows().find((candidate) => candidate.subtopic.id === nodeId);
    const raw = row?.subtopic.cells[columnId]?.raw ?? '';
    this.editingCellKey.set(this.makeCellKey(nodeId, columnId));
    this.editingCellNodeId.set(nodeId);
    this.editingCellColumnId.set(columnId);
    this.formulaEditingMode.set(raw.trim().startsWith('='));
    this.activeReferencedColumnId.set(null);
  }

  stopEditingCell(): void {
    if (this.keepEditingOnNextBlur()) {
      this.keepEditingOnNextBlur.set(false);
      queueMicrotask(() => {
        this.formulaInputRef()?.nativeElement.focus();
      });
      return;
    }

    this.editingCellKey.set(null);
    this.editingCellNodeId.set(null);
    this.editingCellColumnId.set(null);
    this.formulaEditingMode.set(false);
    this.activeReferencedColumnId.set(null);
  }

  isEditingCell(nodeId: string, columnId: string): boolean {
    return this.editingCellKey() === this.makeCellKey(nodeId, columnId);
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
  }

  protected commitColumnRename(columnId: string): void {
    const nextName = this.editingColumnName().trim();
    if (nextName.length > 0) {
      this.renameColumn.emit({ columnId, name: nextName });
    }
    this.editingColumnId.set(null);
    this.editingColumnName.set('');
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

    this.keepEditingOnNextBlur.set(true);
    event.preventDefault();
    event.stopPropagation();
    this.insertColumnReference(clickedColumnId);
  }

  protected onViewCellClick(event: MouseEvent, nodeId: string, columnId: string): void {
    if (this.formulaEditingMode()) {
      event.preventDefault();
      event.stopPropagation();
      this.insertColumnReference(columnId);
      return;
    }

    this.startEditingCell(nodeId, columnId);
  }

  protected onFormulaCursorChange(event: Event): void {
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
    if (!this.isEditingAnyCell()) {
      return;
    }

    const table = this.tableContainerRef()?.nativeElement;
    const target = event.target as Node | null;
    if (!table || !target) {
      this.stopEditingCell();
      return;
    }

    if (!table.contains(target)) {
      this.stopEditingCell();
    }
  }

  protected makeCellKey(nodeId: string, columnId: string): string {
    return `${nodeId}:${columnId}`;
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

  private insertColumnReference(columnId: string): void {
    const nodeId = this.editingCellNodeId();
    const editingColumnId = this.editingCellColumnId();
    const input = this.formulaInputRef()?.nativeElement;
    if (!nodeId || !editingColumnId || !input) {
      return;
    }

    const current = input.value;
    const selectionStart = input.selectionStart ?? current.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    const range = this.getReferenceRangeAtCursor(current, selectionStart);
    const replaceStart = range ? range.start : selectionStart;
    const replaceEnd = range ? range.end : selectionEnd;
    const inserted = `${current.slice(0, replaceStart)}${columnId}${current.slice(replaceEnd)}`;

    this.setCell.emit({
      nodeId,
      columnId: editingColumnId,
      raw: inserted,
    });

    const cellKey = this.makeCellKey(nodeId, editingColumnId);
    const nextCursor = replaceStart + columnId.length;
    this.restoreCaretAfterUpdate(cellKey, inserted, nextCursor);
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

  private restoreCaretAfterUpdate(cellKey: string, expectedRaw: string, nextCursor: number): void {
    let attempts = 0;
    const maxAttempts = 6;

    const applySelection = (): void => {
      attempts += 1;
      const tableRoot = this.tableContainerRef()?.nativeElement;
      const liveInput =
        tableRoot?.querySelector<HTMLInputElement>(`input[data-cell-key=\"${cellKey}\"]`) ??
        this.formulaInputRef()?.nativeElement;

      if (!liveInput) {
        if (attempts < maxAttempts) {
          requestAnimationFrame(applySelection);
        }
        return;
      }

      liveInput.focus();
      liveInput.setSelectionRange(nextCursor, nextCursor);

      // Force horizontal scroll so the caret stays in view near insertion point.
      const textWidthFactor = 8;
      const targetScroll = Math.max(0, nextCursor * textWidthFactor - liveInput.clientWidth / 2);
      liveInput.scrollLeft = targetScroll;

      if (liveInput.value !== expectedRaw && attempts < maxAttempts) {
        requestAnimationFrame(applySelection);
      }
    };

    requestAnimationFrame(applySelection);
  }
}
