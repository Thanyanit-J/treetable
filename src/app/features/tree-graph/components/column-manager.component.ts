import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableColumn } from '../models/tree-table.model';

@Component({
  selector: 'app-column-manager',
  imports: [FormsModule],
  template: `
    <section class="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-600">Columns</h2>
        <div class="flex gap-2">
          <input
            [ngModel]="newColumnName()"
            (ngModelChange)="newColumnName.set($event)"
            placeholder="New column"
            class="w-36 rounded-lg border border-slate-300 px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          />
          <select
            [ngModel]="newColumnType()"
            (ngModelChange)="newColumnType.set($event === 'text' ? 'text' : 'number')"
            class="rounded-lg border border-slate-300 px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          >
            <option value="number">Number</option>
            <option value="text">Text</option>
          </select>
          <button
            (click)="onAddColumn()"
            class="rounded-lg bg-sky-600 px-3 py-1 text-sm font-semibold text-white hover:bg-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            type="button"
          >
            Add
          </button>
        </div>
      </div>

      <ul class="space-y-2">
        @for (column of columns(); track column.id) {
          <li class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            <input
              [ngModel]="column.name"
              (ngModelChange)="rename.emit({ columnId: column.id, name: $event })"
              class="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            />
            <code class="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">{{ column.id }}</code>
            <button
              (click)="remove.emit(column.id)"
              class="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
              type="button"
            >
              Remove
            </button>
          </li>
        }
      </ul>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColumnManagerComponent {
  readonly columns = input.required<TableColumn[]>();

  readonly add = output<{ name: string; type: 'number' | 'text' }>();
  readonly rename = output<{ columnId: string; name: string }>();
  readonly remove = output<string>();

  protected readonly newColumnName = signal('');
  protected readonly newColumnType = signal<'number' | 'text'>('number');

  onAddColumn(): void {
    const name = this.newColumnName().trim();
    this.add.emit({
      name: name.length > 0 ? name : 'New Column',
      type: this.newColumnType(),
    });
    this.newColumnName.set('');
  }
}
