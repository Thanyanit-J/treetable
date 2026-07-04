import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  TopicEvaluation,
  formatNumericValue,
  leafNumericValue,
} from '../../core/engine/formula-evaluator';
import {
  ChartConfigV2,
  ChartType,
  ColumnV2,
  TopicCardV2,
  collectLeaves,
} from '../../core/model/document.model';
import { DocumentStoreService } from '../../core/store/document-store.service';

const SERIES_COLORS = ['#0ea5e9', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6', '#64748b'];

const BAR_WIDTH = 360;
const BAR_HEIGHT = 200;
const BAR_MARGIN = { top: 10, right: 10, bottom: 30, left: 10 };

const PIE_SIZE = 180;

interface BarDatum {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  label: string;
}

interface PieSlice {
  path: string;
  color: string;
  label: string;
}

interface RenderedChart {
  config: ChartConfigV2;
  series: { refName: string; displayName: string; color: string }[];
  bars: BarDatum[];
  zeroLineY: number | null;
  categories: { x: number; label: string }[];
  slices: PieSlice[];
  legend: { color: string; label: string }[];
  missing: string[];
}

/**
 * Chart Panel: charts over this Topic's Leaves, rendered as plain SVG from
 * evaluated values — no chart library, no second data structure. Values come
 * from ALL Leaves (collapse never changes a chart, per CONTEXT.md).
 */
@Component({
  selector: 'app-chart-panel',
  template: `
    <section class="mt-3 border-t border-slate-200 pt-3" aria-label="Charts">
      <div class="mb-2 flex items-center gap-2">
        <span class="text-xs font-semibold uppercase tracking-wide text-slate-400">Charts</span>
        <button type="button" class="panel-button" (click)="addChart('bar')">+ Bar</button>
        <button type="button" class="panel-button" (click)="addChart('pie')">+ Pie</button>
      </div>

      @if (renderedCharts().length === 0) {
        <p class="text-sm text-slate-400">
          No charts yet — add a bar or pie chart of your columns.
        </p>
      }

      <div class="flex flex-wrap items-start gap-4">
        @for (chart of renderedCharts(); track chart.config.id) {
          <figure class="rounded-xl border border-slate-200 bg-white p-3">
            <figcaption class="mb-1 flex items-center justify-between gap-3">
              <span class="text-xs font-medium text-slate-600">
                {{ chart.config.type === 'pie' ? 'Pie' : 'Bar' }} ·
                {{ chartTitle(chart) }}
              </span>
              <button
                type="button"
                class="rounded px-1.5 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-sky-600"
                [attr.aria-label]="'Remove chart'"
                (click)="removeChart(chart.config.id)"
              >
                ✕
              </button>
            </figcaption>

            @if (chart.missing.length > 0) {
              <p class="mb-1 text-xs text-rose-600" role="alert">
                Source missing: {{ chart.missing.join(', ') }}
              </p>
            }

            @if (chart.config.type === 'bar') {
              <svg
                [attr.width]="barWidth"
                [attr.height]="barHeight"
                [attr.viewBox]="'0 0 ' + barWidth + ' ' + barHeight"
                role="img"
                [attr.aria-label]="'Bar chart of ' + chartTitle(chart)"
              >
                @if (chart.zeroLineY !== null) {
                  <line
                    [attr.x1]="0"
                    [attr.x2]="barWidth"
                    [attr.y1]="chart.zeroLineY"
                    [attr.y2]="chart.zeroLineY"
                    stroke="#cbd5e1"
                    stroke-width="1"
                  />
                }
                @for (bar of chart.bars; track $index) {
                  <rect
                    [attr.x]="bar.x"
                    [attr.y]="bar.y"
                    [attr.width]="bar.width"
                    [attr.height]="bar.height"
                    [attr.fill]="bar.color"
                    rx="2"
                  >
                    <title>{{ bar.label }}</title>
                  </rect>
                }
                @for (category of chart.categories; track $index) {
                  <text
                    [attr.x]="category.x"
                    [attr.y]="barHeight - 8"
                    text-anchor="middle"
                    class="fill-slate-500"
                    font-size="10"
                  >
                    {{ category.label }}
                  </text>
                }
              </svg>
            } @else {
              <div class="flex items-center gap-4">
                <svg
                  [attr.width]="pieSize"
                  [attr.height]="pieSize"
                  [attr.viewBox]="'0 0 ' + pieSize + ' ' + pieSize"
                  role="img"
                  [attr.aria-label]="'Pie chart of ' + chartTitle(chart)"
                >
                  @for (slice of chart.slices; track $index) {
                    <path
                      [attr.d]="slice.path"
                      [attr.fill]="slice.color"
                      stroke="white"
                      stroke-width="1"
                    >
                      <title>{{ slice.label }}</title>
                    </path>
                  }
                </svg>
                <ul class="space-y-1 text-xs text-slate-600">
                  @for (item of chart.legend; track $index) {
                    <li class="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        class="inline-block h-2.5 w-2.5 rounded-sm"
                        [style.background]="item.color"
                      ></span>
                      {{ item.label }}
                    </li>
                  }
                </ul>
              </div>
            }

            <div class="mt-2 flex flex-wrap gap-1" role="group" aria-label="Chart columns">
              @for (option of columnOptions(); track option.id) {
                <button
                  type="button"
                  class="rounded-full border px-2 py-0.5 text-[10px] font-medium focus-visible:outline-2 focus-visible:outline-sky-600"
                  [class.border-sky-300]="chart.config.columns.includes(option.refName)"
                  [class.bg-sky-50]="chart.config.columns.includes(option.refName)"
                  [class.text-sky-700]="chart.config.columns.includes(option.refName)"
                  [class.border-slate-200]="!chart.config.columns.includes(option.refName)"
                  [class.text-slate-500]="!chart.config.columns.includes(option.refName)"
                  [attr.aria-pressed]="chart.config.columns.includes(option.refName)"
                  (click)="toggleColumn(chart.config.id, option.refName)"
                >
                  {{ option.displayName }}
                </button>
              }
            </div>
          </figure>
        }
      </div>
    </section>
  `,
  styles: `
    .panel-button {
      border-radius: 0.375rem;
      border: 1px solid var(--color-slate-200);
      background: white;
      padding: 0.125rem 0.5rem;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--color-slate-600);
    }
    .panel-button:hover {
      background: var(--color-slate-50);
    }
    .panel-button:focus-visible {
      outline: 2px solid var(--color-sky-600);
      outline-offset: 1px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartPanelComponent {
  protected readonly store = inject(DocumentStoreService);

  readonly topic = input.required<TopicCardV2>();
  readonly evaluation = input.required<TopicEvaluation>();
  /** Overrides the Topic's own charts (Chart Cards pass theirs in). */
  readonly charts = input<ChartConfigV2[] | null>(null);
  /** Where add/remove/toggle route; defaults to the Topic itself. */
  readonly owner = input<{ kind: 'topic' | 'chartcard'; id: string } | null>(null);

  protected readonly barWidth = BAR_WIDTH;
  protected readonly barHeight = BAR_HEIGHT;
  protected readonly pieSize = PIE_SIZE;

  protected addChart(type: ChartType): void {
    const owner = this.owner();
    if (owner?.kind === 'chartcard') {
      this.store.addChartToCard(owner.id, type);
    } else {
      this.store.addChart(this.topic().id, type);
    }
  }

  protected removeChart(chartId: string): void {
    const owner = this.owner();
    if (owner?.kind === 'chartcard') {
      this.store.removeChartFromCard(owner.id, chartId);
    } else {
      this.store.removeChart(this.topic().id, chartId);
    }
  }

  protected toggleColumn(chartId: string, refName: string): void {
    const owner = this.owner();
    if (owner?.kind === 'chartcard') {
      this.store.toggleChartCardColumn(owner.id, chartId, refName);
    } else {
      this.store.toggleChartColumn(this.topic().id, chartId, refName);
    }
  }

  protected readonly columnOptions = computed(() =>
    this.topic().columns.filter((column) => column.kind !== 'chart'),
  );

  protected readonly renderedCharts = computed<RenderedChart[]>(() => {
    const topic = this.topic();
    const evaluation = this.evaluation();
    const leaves = collectLeaves(topic.children);
    const columnsByRef = new Map(topic.columns.map((column) => [column.refName, column]));

    return (this.charts() ?? topic.charts ?? []).map((config) => {
      const series: { refName: string; displayName: string; color: string; column: ColumnV2 }[] =
        [];
      const missing: string[] = [];
      for (const [index, refName] of config.columns.entries()) {
        const column = columnsByRef.get(refName);
        if (column && column.kind !== 'chart') {
          series.push({
            refName,
            displayName: column.displayName,
            color: SERIES_COLORS[index % SERIES_COLORS.length]!,
            column,
          });
        } else {
          missing.push(refName);
        }
      }

      const values = series.map((entry) =>
        leaves.map((leaf) => leafNumericValue(entry.column, leaf, evaluation) ?? 0),
      );

      if (config.type === 'pie') {
        return {
          config,
          series,
          missing,
          bars: [],
          zeroLineY: null,
          categories: [],
          ...this.renderPie(
            leaves.map((leaf) => leaf.displayName),
            values[0] ?? [],
            series[0]?.displayName ?? '',
          ),
        };
      }

      return {
        config,
        series,
        missing,
        slices: [],
        legend: series.map((entry) => ({ color: entry.color, label: entry.displayName })),
        ...this.renderBars(
          leaves.map((leaf) => leaf.displayName),
          values,
          series,
        ),
      };
    });
  });

  protected chartTitle(chart: RenderedChart): string {
    return chart.series.map((entry) => entry.displayName).join(', ') || '—';
  }

  private renderBars(
    categories: string[],
    values: number[][],
    series: { color: string; displayName: string }[],
  ): { bars: BarDatum[]; zeroLineY: number | null; categories: { x: number; label: string }[] } {
    const plotWidth = BAR_WIDTH - BAR_MARGIN.left - BAR_MARGIN.right;
    const plotHeight = BAR_HEIGHT - BAR_MARGIN.top - BAR_MARGIN.bottom;
    if (categories.length === 0 || series.length === 0) {
      return { bars: [], zeroLineY: null, categories: [] };
    }

    const all = values.flat();
    const min = Math.min(0, ...all);
    const max = Math.max(0, ...all);
    const range = max - min || 1;
    const yOf = (value: number): number => BAR_MARGIN.top + ((max - value) / range) * plotHeight;
    const zeroY = yOf(0);

    const groupWidth = plotWidth / categories.length;
    const barWidth = Math.min(22, (groupWidth * 0.8) / series.length);

    const bars: BarDatum[] = [];
    for (const [seriesIndex, seriesValues] of values.entries()) {
      for (const [categoryIndex, value] of seriesValues.entries()) {
        const groupStart = BAR_MARGIN.left + categoryIndex * groupWidth;
        const x =
          groupStart + groupWidth / 2 - (series.length * barWidth) / 2 + seriesIndex * barWidth;
        const y = Math.min(zeroY, yOf(value));
        const height = Math.max(1, Math.abs(zeroY - yOf(value)));
        bars.push({
          x,
          y,
          width: Math.max(2, barWidth - 2),
          height,
          color: series[seriesIndex]?.color ?? SERIES_COLORS[0]!,
          label: `${categories[categoryIndex]} — ${series[seriesIndex]?.displayName}: ${formatNumericValue(value)}`,
        });
      }
    }

    return {
      bars,
      zeroLineY: zeroY,
      categories: categories.map((label, index) => ({
        x: BAR_MARGIN.left + index * groupWidth + groupWidth / 2,
        label: label.length > 8 ? `${label.slice(0, 7)}…` : label,
      })),
    };
  }

  private renderPie(
    labels: string[],
    values: number[],
    seriesName: string,
  ): { slices: PieSlice[]; legend: { color: string; label: string }[] } {
    const positives = values
      .map((value, index) => ({ value, label: labels[index] ?? '' }))
      .filter((entry) => entry.value > 0);
    const total = positives.reduce((sum, entry) => sum + entry.value, 0);
    if (total <= 0) {
      return {
        slices: [],
        legend: [{ color: '#e2e8f0', label: `${seriesName}: no positive values` }],
      };
    }

    const cx = PIE_SIZE / 2;
    const cy = PIE_SIZE / 2;
    const radius = PIE_SIZE / 2 - 4;
    const slices: PieSlice[] = [];
    const legend: { color: string; label: string }[] = [];

    let angle = -Math.PI / 2;
    for (const [index, entry] of positives.entries()) {
      const fraction = entry.value / total;
      const nextAngle = angle + fraction * Math.PI * 2;
      const color = SERIES_COLORS[index % SERIES_COLORS.length]!;
      const largeArc = fraction > 0.5 ? 1 : 0;
      const x1 = cx + radius * Math.cos(angle);
      const y1 = cy + radius * Math.sin(angle);
      const x2 = cx + radius * Math.cos(nextAngle);
      const y2 = cy + radius * Math.sin(nextAngle);
      const path =
        fraction >= 0.999
          ? `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius} Z`
          : `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
      slices.push({
        path,
        color,
        label: `${entry.label}: ${formatNumericValue(entry.value)} (${Math.round(fraction * 100)}%)`,
      });
      legend.push({
        color,
        label: `${entry.label} · ${Math.round(fraction * 100)}%`,
      });
      angle = nextAngle;
    }

    return { slices, legend };
  }
}
