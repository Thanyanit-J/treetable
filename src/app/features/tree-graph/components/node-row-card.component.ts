import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CellData, TableColumn } from '../models/tree-table.model';
import { FormulaCellComponent } from './formula-cell.component';

@Component({
  selector: 'app-node-row-card',
  imports: [FormulaCellComponent],
  template: `
    <article
      class="w-full rounded-xl border bg-white/90 p-3 shadow-sm"
      [class.border-sky-300]="selected()"
      [class.border-slate-200]="!selected()"
      [attr.aria-label]="ariaLabel()"
    >
      <header class="mb-2 flex items-center justify-between gap-2">
        <h3 class="truncate text-sm font-semibold text-slate-700">{{ label() }}</h3>
        <span
          class="rounded-full px-2 py-0.5 text-xs font-medium"
          [class.bg-sky-100]="kind() === 'topic'"
          [class.text-sky-800]="kind() === 'topic'"
          [class.bg-amber-100]="kind() === 'subtopic'"
          [class.text-amber-800]="kind() === 'subtopic'"
        >
          {{ kind() }}
        </span>
      </header>

      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        @for (column of columns(); track column.id) {
          @let cell = getCell(column.id);
          <app-formula-cell
            [label]="column.name"
            [raw]="cell.raw"
            [error]="cell.error"
            [value]="cell.value"
            [describedBy]="errorId(nodeId(), column.id)"
            (rawChange)="setCell.emit({ nodeId: nodeId(), columnId: column.id, raw: $event })"
          />
        }
      </div>
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodeRowCardComponent {
  readonly nodeId = input.required<string>();
  readonly label = input.required<string>();
  readonly kind = input.required<'topic' | 'subtopic'>();
  readonly selected = input(false);
  readonly columns = input.required<TableColumn[]>();
  readonly cells = input.required<Record<string, CellData>>();

  readonly setCell = output<{ nodeId: string; columnId: string; raw: string }>();

  protected readonly ariaLabel = computed(
    () => `${this.kind() === 'topic' ? 'Topic' : 'Subtopic'} data row for ${this.label()}`,
  );

  getCell(columnId: string): CellData {
    return this.cells()[columnId] ?? { raw: '', value: null, error: null };
  }

  errorId(nodeId: string, columnId: string): string {
    return `error-${nodeId}-${columnId}`;
  }

}
