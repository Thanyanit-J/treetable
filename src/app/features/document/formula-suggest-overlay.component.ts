import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormulaSuggestService } from './formula-suggest.service';

/** The single autocomplete dropdown, anchored under the active formula editor. */
@Component({
  selector: 'app-formula-suggest-overlay',
  template: `
    @if (suggest.state(); as state) {
      <div
        class="fixed z-50 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
        role="listbox"
        aria-label="Formula suggestions"
        [style.left.px]="state.left"
        [style.top.px]="state.top"
        [style.min-width.px]="state.minWidth"
      >
        @for (item of state.items; track item.label; let index = $index) {
          <div
            role="option"
            class="flex cursor-pointer items-baseline gap-3 px-3 py-1.5 text-sm hover:bg-slate-100"
            [class.bg-sky-100]="index === state.activeIndex"
            [attr.aria-selected]="index === state.activeIndex"
            (pointerdown)="pick($event, index)"
          >
            <span class="font-mono text-slate-800">{{ item.label }}</span>
            <span class="ml-auto text-xs text-slate-400">{{ item.detail }}</span>
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormulaSuggestOverlayComponent {
  protected readonly suggest = inject(FormulaSuggestService);

  /** pointerdown (not click) so the editor never loses focus. */
  protected pick(event: Event, index: number): void {
    event.preventDefault();
    this.suggest.accept(index);
  }
}
