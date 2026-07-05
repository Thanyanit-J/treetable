import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TopicEvaluation } from '../../core/engine/formula-evaluator';
import { ChartCardV2 } from '../../core/model/document.model';
import { DocumentStoreService } from '../../core/store/document-store.service';
import { ChartPanelComponent } from './chart-panel.component';

/** Charts over another Topic's Leaves, hosted as a standalone card. */
@Component({
  selector: 'app-chart-card',
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger, ChartPanelComponent],
  template: `
    <article class="relative flex h-full min-w-64 shrink-0 flex-col">
      <div class="flex h-7 shrink-0 items-center pl-2 pr-8">
        <span class="truncate text-xs font-semibold text-slate-600">
          Charts · {{ sourceTopic()?.displayName ?? 'missing source' }}
        </span>
      </div>
      <button
        type="button"
        class="absolute right-1 top-1 z-30 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-sky-600"
        [cdkMenuTriggerFor]="chartCardMenu"
        aria-label="Actions for charts card"
      >
        <span aria-hidden="true">⋯</span>
      </button>

      <div
        class="relative flex min-h-0 flex-1 flex-col overflow-auto border border-slate-200 bg-white shadow-sm"
        (click)="onCardClick($event)"
      >
        @if (isCardFocused()) {
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-y-0 left-0 z-30 w-1 bg-sky-400"
          ></div>
        }
        @if (sourceTopic(); as topic) {
          <div class="p-2">
            <app-chart-panel
              [topic]="topic"
              [evaluation]="evaluation()"
              [charts]="card().charts"
              [owner]="{ kind: 'chartcard', id: card().id }"
              [frameless]="true"
            />
          </div>
        } @else {
          <p class="p-4 text-sm text-rose-600">
            The tree-table these charts visualized was deleted.
          </p>
        }
      </div>
    </article>

    <ng-template #chartCardMenu>
      <div
        cdkMenu
        class="z-50 w-44 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-700 shadow-xl"
      >
        <button
          cdkMenuItem
          type="button"
          class="menu-item text-rose-700"
          (cdkMenuItemTriggered)="requestDelete.emit(card().id)"
        >
          Delete charts card
        </button>
      </div>
    </ng-template>
  `,
  styles: `
    .menu-item {
      display: block;
      width: 100%;
      border-radius: 0.375rem;
      padding: 0.5rem 0.75rem;
      text-align: left;
    }
    .menu-item:hover,
    .menu-item:focus-visible {
      background: var(--color-slate-100);
      outline: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartCardComponent {
  protected readonly store = inject(DocumentStoreService);

  readonly card = input.required<ChartCardV2>();
  readonly requestDelete = output<string>();

  private readonly emptyEvaluation: TopicEvaluation = { computedCells: new Map() };

  protected readonly sourceTopic = computed(
    () => this.store.topicById(this.card().sourceTopicId) ?? null,
  );
  protected readonly evaluation = computed(
    () => this.store.evaluations().get(this.card().sourceTopicId) ?? this.emptyEvaluation,
  );
  protected readonly isCardFocused = computed(
    () => this.store.selection()?.topicId === this.card().id,
  );

  /** The card IS its chart: clicking anywhere selects the chart for editing. */
  protected onCardClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('button, input, select, textarea, a, [tabindex]')) {
      return;
    }
    const chart = this.card().charts[0];
    if (chart) {
      this.store.select({ kind: 'chart', topicId: this.card().id, chartId: chart.id });
    } else {
      this.store.select({ kind: 'card', topicId: this.card().id });
    }
  }
}
