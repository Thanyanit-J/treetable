import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-formula-cell',
  imports: [FormsModule],
  template: `
    <label class="space-y-1 text-xs text-slate-600">
      <span class="font-medium">{{ label() }}</span>
      <input
        [ngModel]="raw()"
        (ngModelChange)="rawChange.emit($event)"
        [attr.aria-invalid]="error() ? 'true' : 'false'"
        [attr.aria-describedby]="error() ? describedBy() : null"
        class="w-full rounded-lg border px-2 py-1.5 text-sm text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
        [class.border-rose-300]="!!error()"
        [class.border-slate-300]="!error()"
      />
      <div class="min-h-5 text-[11px]" [id]="describedBy()" aria-live="polite">
        @if (error()) {
          <span class="font-medium text-rose-600">{{ error() }}</span>
        } @else {
          <span class="text-slate-500">Value: {{ valueLabel() }}</span>
        }
      </div>
    </label>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormulaCellComponent {
  readonly label = input.required<string>();
  readonly raw = input.required<string>();
  readonly error = input<string | null>(null);
  readonly value = input<number | string | null>(null);
  readonly describedBy = input.required<string>();

  readonly rawChange = output<string>();

  protected readonly valueLabel = computed(() => {
    const value = this.value();
    if (value === null) {
      return '-';
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
    return String(value);
  });
}
