import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableColumn } from '../models/tree-table.model';
import { VisibleSubtopicRow } from '../services/tree-table-store.service';
import { ColumnContextMenuComponent } from './column-context-menu.component';

@Component({
  selector: 'app-subtopic-table',
  imports: [FormsModule, ColumnContextMenuComponent],
  template: `
    <section class="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm" aria-label="Subtopic table">
      <div class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Subtopic Table</div>

      <div class="overflow-auto">
        <table class="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                class="sticky left-0 z-10 border border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700"
              >
                Subtopic
              </th>
              @for (column of columns(); track column.id) {
                <th
                  scope="col"
                  class="min-w-40 border border-slate-200 bg-slate-100 px-2 py-2 text-left font-semibold text-slate-700"
                  (contextmenu)="openMenu($event, column.id)"
                >
                  <div class="flex items-center gap-2">
                    @if (editingColumnId() === column.id) {
                      <input
                        [ngModel]="column.name"
                        (ngModelChange)="renameColumn.emit({ columnId: column.id, name: $event })"
                        (blur)="editingColumnId.set(null)"
                        (keydown.enter)="editingColumnId.set(null)"
                        class="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                        [attr.aria-label]="'Rename column ' + column.name"
                      />
                    } @else {
                      <button
                        (dblclick)="editingColumnId.set(column.id)"
                        (click)="selectColumn(column.id)"
                        class="truncate text-left"
                        type="button"
                      >
                        {{ column.name }}
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
                <th
                  scope="row"
                  class="sticky left-0 z-[1] border border-slate-200 bg-white px-3 py-2 text-left align-top"
                >
                  <div class="space-y-1">
                    <span class="block text-xs text-slate-500">{{ row.topicLabel }}</span>
                    <input
                      [ngModel]="row.subtopic.label"
                      (focus)="selectNode.emit(row.subtopic.id)"
                      (ngModelChange)="renameNode.emit({ nodeId: row.subtopic.id, label: $event })"
                      class="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-medium text-slate-800 focus:border-slate-300 focus:bg-white"
                    />
                  </div>
                </th>

                @for (column of columns(); track column.id) {
                  @let cell = row.subtopic.cells[column.id];
                  <td class="border border-slate-200 px-2 py-2 align-top" (contextmenu)="openMenu($event, column.id)">
                    <div class="space-y-1">
                      <input
                        [ngModel]="cell?.raw ?? ''"
                        (focus)="selectNode.emit(row.subtopic.id)"
                        (ngModelChange)="setCell.emit({ nodeId: row.subtopic.id, columnId: column.id, raw: $event })"
                        [attr.aria-invalid]="cell?.error ? 'true' : 'false'"
                        class="w-full rounded border px-2 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500"
                        [class.border-rose-300]="!!cell?.error"
                        [class.border-slate-300]="!cell?.error"
                      />
                      <div class="min-h-4 text-[11px]" aria-live="polite">
                        @if (cell?.error) {
                          <span class="text-rose-600">{{ cell?.error }}</span>
                        } @else {
                          <span class="text-slate-500">{{ formatValue(cell?.value ?? null) }}</span>
                        }
                      </div>
                    </div>
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td
                  [attr.colspan]="columns().length + 1"
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

  readonly renameNode = output<{ nodeId: string; label: string }>();
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

    this.editingColumnId.set(columnId);
    this.closeMenu();
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  formatValue(value: number | string | null): string {
    if (value === null || value === '') {
      return '—';
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
    return String(value);
  }
}
