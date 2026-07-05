import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import {
  TopicEvaluation,
  formatNumericValue,
  leafNumericValue,
} from '../../core/engine/formula-evaluator';
import {
  ChartConfigV2,
  ChartRowRollup,
  ColumnV2,
  NodeV2,
  TopicCardV2,
  collectLeaves,
  walkNodes,
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
      <div class="flex flex-wrap items-start gap-4">
        @for (chart of renderedCharts(); track chart.config.id) {
          <figure
            class="relative rounded-xl border border-slate-200 bg-white p-3"
            [class.ring-2]="isChartSelected(chart.config.id)"
            [class.ring-sky-400]="isChartSelected(chart.config.id)"
            (click)="selectChart(chart.config.id, $event)"
          >
            <!-- Instant tooltip; the SVG <title> children remain for AT. -->
            @if (tooltip(); as tip) {
              @if (tip.chartId === chart.config.id) {
                <div
                  class="pointer-events-none absolute z-20 max-w-56 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] leading-snug text-white shadow"
                  [style.left.px]="tip.x"
                  [style.top.px]="tip.y"
                  role="status"
                >
                  {{ tip.label }}
                </div>
              }
            }
            <figcaption class="mb-1 flex items-center justify-between gap-3">
              <span class="text-xs font-medium text-slate-600">
                {{ chartCaption(chart) }}
              </span>
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
                    (pointermove)="showTip(chart.config.id, bar.label, $event)"
                    (pointerleave)="hideTip()"
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
                      (pointermove)="showTip(chart.config.id, slice.label, $event)"
                      (pointerleave)="hideTip()"
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
          </figure>
        }
      </div>
    </section>
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

  /** The card owning these charts (the Topic itself unless a Chart Card). */
  protected ownerId(): string {
    return this.owner()?.id ?? this.topic().id;
  }

  /** One tooltip per panel, following the pointer over bars and slices. */
  protected readonly tooltip = signal<{
    chartId: string;
    label: string;
    x: number;
    y: number;
  } | null>(null);

  protected showTip(chartId: string, label: string, event: PointerEvent): void {
    const figure = (event.currentTarget as Element).closest('figure');
    if (!figure) {
      return;
    }
    const rect = figure.getBoundingClientRect();
    this.tooltip.set({
      chartId,
      label,
      x: event.clientX - rect.left + 12,
      y: event.clientY - rect.top + 14,
    });
  }

  protected hideTip(): void {
    this.tooltip.set(null);
  }

  protected isChartSelected(chartId: string): boolean {
    const selection = this.store.selection();
    return (
      selection?.kind === 'chart' &&
      selection.topicId === this.ownerId() &&
      selection.chartId === chartId
    );
  }

  /** Click selects the chart for the Details panel (buttons keep their jobs). */
  protected selectChart(chartId: string, event: Event): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button')) {
      return;
    }
    event.stopPropagation();
    this.store.select({ kind: 'chart', topicId: this.ownerId(), chartId });
  }

  protected readonly renderedCharts = computed<RenderedChart[]>(() => {
    const topic = this.topic();
    const evaluation = this.evaluation();
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

      const rows = this.chartRows(topic, config);
      const rollup = config.rowRollup ?? 'sum';
      const values = series.map((entry) =>
        rows.map((node) => this.rowValue(entry.column, node, evaluation, rollup)),
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
            rows.map((node) => node.displayName),
            values,
            series.map((entry) => entry.displayName),
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
          rows.map((node) => node.displayName),
          values,
          series,
        ),
      };
    });
  });

  /** Rows charted: the config's node ids (tree order) or every Leaf. */
  private chartRows(topic: TopicCardV2, config: ChartConfigV2): NodeV2[] {
    if (!config.rows) {
      return collectLeaves(topic.children);
    }
    const wanted = new Set(config.rows);
    const rows: NodeV2[] = [];
    walkNodes(topic.children, (node) => {
      if (wanted.has(node.id)) {
        rows.push(node);
      }
    });
    return rows;
  }

  /** A Leaf charts its cell; a Branch charts its subtree aggregated per column. */
  private rowValue(
    column: ColumnV2,
    node: NodeV2,
    evaluation: TopicEvaluation,
    rollup: ChartRowRollup,
  ): number {
    if (node.children.length === 0) {
      return leafNumericValue(column, node, evaluation) ?? 0;
    }
    const values = collectLeaves(node.children)
      .map((leaf) => leafNumericValue(column, leaf, evaluation))
      .filter((value): value is number => value !== null);
    if (values.length === 0) {
      return 0;
    }
    switch (rollup) {
      case 'sum':
        return values.reduce((sum, value) => sum + value, 0);
      case 'avg':
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'count':
        return values.length;
    }
  }

  protected chartTitle(chart: RenderedChart): string {
    return chart.config.name ?? (chart.series.map((entry) => entry.displayName).join(', ') || '—');
  }

  protected chartCaption(chart: RenderedChart): string {
    if (chart.config.name !== undefined) {
      return chart.config.name;
    }
    return `${chart.config.type === 'pie' ? 'Pie' : 'Bar'} · ${this.chartTitle(chart)}`;
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

  /**
   * One ring per source column: a single source draws the classic pie, more
   * sources stack as concentric rings (inner = first source). Slice colors
   * follow the Leaf, so rings align visually; each ring's angles are its own
   * distribution.
   */
  private renderPie(
    labels: string[],
    valuesPerSeries: number[][],
    seriesNames: string[],
  ): { slices: PieSlice[]; legend: { color: string; label: string }[] } {
    const rings = valuesPerSeries.length;
    if (rings === 0) {
      return { slices: [], legend: [] };
    }
    const cx = PIE_SIZE / 2;
    const cy = PIE_SIZE / 2;
    const outer = PIE_SIZE / 2 - 4;
    const band = outer / rings;
    const slices: PieSlice[] = [];
    const seenLeaves = new Set<number>();

    for (const [ring, values] of valuesPerSeries.entries()) {
      const positives = values
        .map((value, index) => ({ value, index }))
        .filter((entry) => entry.value > 0);
      const total = positives.reduce((sum, entry) => sum + entry.value, 0);
      if (total <= 0) {
        continue;
      }
      const innerRadius = ring * band;
      const outerRadius = (ring + 1) * band;
      let angle = -Math.PI / 2;
      for (const entry of positives) {
        const fraction = entry.value / total;
        const nextAngle = angle + fraction * Math.PI * 2;
        seenLeaves.add(entry.index);
        slices.push({
          path: this.piePath(cx, cy, innerRadius, outerRadius, angle, nextAngle, fraction),
          color: SERIES_COLORS[entry.index % SERIES_COLORS.length]!,
          label: `${labels[entry.index]} — ${seriesNames[ring]}: ${formatNumericValue(entry.value)} (${Math.round(fraction * 100)}%)`,
        });
        angle = nextAngle;
      }
    }

    if (slices.length === 0) {
      return { slices: [], legend: [{ color: '#e2e8f0', label: 'no positive values' }] };
    }
    const legend = [...seenLeaves]
      .sort((a, b) => a - b)
      .map((index) => ({
        color: SERIES_COLORS[index % SERIES_COLORS.length]!,
        label: labels[index] ?? '',
      }));
    return { slices, legend };
  }

  /** Wedge (innerRadius 0) or annular sector between two angles. */
  private piePath(
    cx: number,
    cy: number,
    innerRadius: number,
    outerRadius: number,
    start: number,
    end: number,
    fraction: number,
  ): string {
    if (fraction >= 0.999) {
      const outerRing = `M ${cx} ${cy - outerRadius} A ${outerRadius} ${outerRadius} 0 1 1 ${cx - 0.01} ${cy - outerRadius} Z`;
      if (innerRadius <= 0) {
        return outerRing;
      }
      // Counter-wound inner circle carves the hole (nonzero fill rule).
      return `${outerRing} M ${cx} ${cy - innerRadius} A ${innerRadius} ${innerRadius} 0 1 0 ${cx - 0.01} ${cy - innerRadius} Z`;
    }

    const large = fraction > 0.5 ? 1 : 0;
    const x1 = cx + outerRadius * Math.cos(start);
    const y1 = cy + outerRadius * Math.sin(start);
    const x2 = cx + outerRadius * Math.cos(end);
    const y2 = cy + outerRadius * Math.sin(end);
    if (innerRadius <= 0) {
      return `M ${cx} ${cy} L ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 ${large} 1 ${x2} ${y2} Z`;
    }
    const xi1 = cx + innerRadius * Math.cos(start);
    const yi1 = cy + innerRadius * Math.sin(start);
    const xi2 = cx + innerRadius * Math.cos(end);
    const yi2 = cy + innerRadius * Math.sin(end);
    return `M ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${innerRadius} ${innerRadius} 0 ${large} 0 ${xi1} ${yi1} Z`;
  }
}
