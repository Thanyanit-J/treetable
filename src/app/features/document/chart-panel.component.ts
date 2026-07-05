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

function transpose(matrix: number[][]): number[][] {
  const innerLength = matrix[0]?.length ?? 0;
  return Array.from({ length: innerLength }, (_, index) =>
    matrix.map((entries) => entries[index] ?? 0),
  );
}

/** Rounded tick values covering [min, max] in 1/2/5 × 10ᵏ steps. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

const BAR_WIDTH = 360;
const BAR_HEIGHT = 200;
const BAR_MARGIN = { top: 10, right: 12, bottom: 30, left: 48 };

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

interface ChartLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface ChartText {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  label: string;
}

interface LineSeries {
  points: string;
  color: string;
  markers: { x: number; y: number; label: string }[];
}

interface RenderedChart {
  config: ChartConfigV2;
  series: { refName: string; displayName: string; color: string }[];
  bars: BarDatum[];
  lines: LineSeries[];
  gridLines: ChartLine[];
  tickLabels: ChartText[];
  categoryLabels: ChartText[];
  zeroLine: ChartLine | null;
  slices: PieSlice[];
  legend: { color: string; label: string }[];
  missing: string[];
}

/**
 * Chart Panel: a Charts card's charts over its source Topic's Leaves,
 * rendered as plain SVG from evaluated values — no chart library, no second
 * data structure. Values come from ALL Leaves (collapse never changes a
 * chart, per CONTEXT.md).
 */
@Component({
  selector: 'app-chart-panel',
  template: `
    <section
      class="border-slate-200"
      [class.mt-3]="!frameless()"
      [class.border-t]="!frameless()"
      [class.pt-3]="!frameless()"
      aria-label="Charts"
    >
      <div class="flex flex-wrap items-start gap-4">
        @for (chart of renderedCharts(); track chart.config.id) {
          <figure
            class="relative bg-white"
            [class.rounded-xl]="!frameless()"
            [class.border]="!frameless()"
            [class.border-slate-200]="!frameless()"
            [class.p-3]="!frameless()"
            [class.w-full]="frameless()"
            [class.ring-2]="isChartSelected(chart.config.id) && !frameless()"
            [class.ring-sky-400]="isChartSelected(chart.config.id) && !frameless()"
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

            @if (chart.config.type !== 'pie') {
              <svg
                class="block"
                [class.w-full]="frameless()"
                [class.h-auto]="frameless()"
                [attr.width]="barWidth"
                [attr.height]="barHeight"
                [attr.viewBox]="'0 0 ' + barWidth + ' ' + barHeight"
                role="img"
                [attr.aria-label]="chart.config.type + ' chart of ' + chartTitle(chart)"
              >
                @for (grid of chart.gridLines; track $index) {
                  <line
                    [attr.x1]="grid.x1"
                    [attr.y1]="grid.y1"
                    [attr.x2]="grid.x2"
                    [attr.y2]="grid.y2"
                    stroke="#f1f5f9"
                    stroke-width="1"
                  />
                }
                @if (chart.zeroLine; as zero) {
                  <line
                    [attr.x1]="zero.x1"
                    [attr.y1]="zero.y1"
                    [attr.x2]="zero.x2"
                    [attr.y2]="zero.y2"
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
                @for (line of chart.lines; track $index) {
                  <polyline
                    [attr.points]="line.points"
                    fill="none"
                    [attr.stroke]="line.color"
                    stroke-width="2"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                  @for (marker of line.markers; track $index) {
                    <circle
                      [attr.cx]="marker.x"
                      [attr.cy]="marker.y"
                      r="3"
                      [attr.fill]="line.color"
                      (pointermove)="showTip(chart.config.id, marker.label, $event)"
                      (pointerleave)="hideTip()"
                    >
                      <title>{{ marker.label }}</title>
                    </circle>
                  }
                }
                @for (tick of chart.tickLabels; track $index) {
                  <text
                    [attr.x]="tick.x"
                    [attr.y]="tick.y"
                    [attr.text-anchor]="tick.anchor"
                    class="fill-slate-400"
                    font-size="9"
                  >
                    {{ tick.label }}
                  </text>
                }
                @for (category of chart.categoryLabels; track $index) {
                  <text
                    [attr.x]="category.x"
                    [attr.y]="category.y"
                    [attr.text-anchor]="category.anchor"
                    class="fill-slate-500"
                    font-size="10"
                  >
                    {{ category.label }}
                  </text>
                }
              </svg>
              @if (chart.legend.length > 1) {
                <ul class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
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
              }
            } @else {
              <div class="flex items-center gap-4" [class.flex-col]="frameless()">
                <svg
                  [class.w-full]="frameless()"
                  [class.max-w-80]="frameless()"
                  [class.h-auto]="frameless()"
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

  /** The source Topic whose Leaves feed the charts. */
  readonly topic = input.required<TopicCardV2>();
  readonly evaluation = input.required<TopicEvaluation>();
  readonly charts = input<ChartConfigV2[] | null>(null);
  /** The Charts card owning these charts (selection routes to it). */
  readonly owner = input<{ kind: 'topic' | 'chartcard'; id: string } | null>(null);
  /** Chart Cards render bare: no figure chrome, the chart scales to the card. */
  readonly frameless = input(false);

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

    return (this.charts() ?? []).map((config) => {
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

      // categoryAxis 'columns' swaps the dimensions: columns become the
      // categories and each row turns into a coloured series.
      const swapped = config.categoryAxis === 'columns';
      const labelColumn = config.labelColumn
        ? (topic.columns.find(
            (column) => column.refName === config.labelColumn && column.kind !== 'chart',
          ) ?? null)
        : null;
      const categories = swapped
        ? series.map((entry) => entry.displayName)
        : rows.map((node) => this.rowLabel(node, labelColumn, evaluation));
      const plotSeries = swapped
        ? rows.map((node, index) => ({
            displayName: node.displayName,
            color: SERIES_COLORS[index % SERIES_COLORS.length]!,
          }))
        : series;
      const matrix = swapped ? transpose(values) : values;

      if (config.type === 'pie') {
        return {
          config,
          series,
          missing,
          bars: [],
          lines: [],
          gridLines: [],
          tickLabels: [],
          categoryLabels: [],
          zeroLine: null,
          ...this.renderPie(
            categories,
            matrix,
            plotSeries.map((entry) => entry.displayName),
          ),
        };
      }

      const legend = plotSeries.map((entry) => ({ color: entry.color, label: entry.displayName }));
      if (config.type === 'line') {
        return {
          config,
          series,
          missing,
          slices: [],
          bars: [],
          legend,
          ...this.renderLine(categories, matrix, plotSeries),
        };
      }

      return {
        config,
        series,
        missing,
        slices: [],
        lines: [],
        legend,
        ...(config.horizontal
          ? this.renderHorizontalBars(categories, matrix, plotSeries)
          : this.renderBars(categories, matrix, plotSeries)),
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

  /** A row's category label: the label column's cell (Leaves) or the row's name. */
  private rowLabel(
    node: NodeV2,
    labelColumn: ColumnV2 | null,
    evaluation: TopicEvaluation,
  ): string {
    if (!labelColumn || node.children.length > 0) {
      return node.displayName;
    }
    if (labelColumn.kind === 'computed') {
      const value = leafNumericValue(labelColumn, node, evaluation);
      return value !== null ? formatNumericValue(value) : node.displayName;
    }
    const raw = (node.values[labelColumn.id] ?? '').trim();
    return raw.length > 0 ? raw : node.displayName;
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
    const kind = { bar: 'Bar', line: 'Line', pie: 'Pie' }[chart.config.type];
    return `${kind} · ${this.chartTitle(chart)}`;
  }

  private renderBars(
    categories: string[],
    values: number[][],
    series: { color: string; displayName: string }[],
  ): Pick<RenderedChart, 'bars' | 'gridLines' | 'tickLabels' | 'categoryLabels' | 'zeroLine'> {
    const plotWidth = BAR_WIDTH - BAR_MARGIN.left - BAR_MARGIN.right;
    const plotHeight = BAR_HEIGHT - BAR_MARGIN.top - BAR_MARGIN.bottom;
    if (categories.length === 0 || series.length === 0) {
      return { bars: [], gridLines: [], tickLabels: [], categoryLabels: [], zeroLine: null };
    }

    const all = values.flat();
    const min = Math.min(0, ...all);
    const max = Math.max(0, ...all);
    const range = max - min || 1;
    const yOf = (value: number): number => BAR_MARGIN.top + ((max - value) / range) * plotHeight;
    const zeroY = yOf(0);
    const axis = this.valueAxis(min, max, yOf);

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
      ...axis,
      zeroLine: {
        x1: BAR_MARGIN.left,
        y1: zeroY,
        x2: BAR_MARGIN.left + plotWidth,
        y2: zeroY,
      },
      categoryLabels: categories.map((label, index) => ({
        x: BAR_MARGIN.left + index * groupWidth + groupWidth / 2,
        y: BAR_HEIGHT - 8,
        anchor: 'middle' as const,
        label: label.length > 8 ? `${label.slice(0, 7)}…` : label,
      })),
    };
  }

  /** Categories run down the y axis; the value axis lies along the bottom. */
  private renderHorizontalBars(
    categories: string[],
    values: number[][],
    series: { color: string; displayName: string }[],
  ): Pick<RenderedChart, 'bars' | 'gridLines' | 'tickLabels' | 'categoryLabels' | 'zeroLine'> {
    const margin = { top: 8, right: 12, bottom: 22, left: 76 };
    const plotWidth = BAR_WIDTH - margin.left - margin.right;
    const plotHeight = BAR_HEIGHT - margin.top - margin.bottom;
    if (categories.length === 0 || series.length === 0) {
      return { bars: [], gridLines: [], tickLabels: [], categoryLabels: [], zeroLine: null };
    }

    const all = values.flat();
    const min = Math.min(0, ...all);
    const max = Math.max(0, ...all);
    const range = max - min || 1;
    const xOf = (value: number): number => margin.left + ((value - min) / range) * plotWidth;
    const zeroX = xOf(0);

    const gridLines: ChartLine[] = [];
    const tickLabels: ChartText[] = [];
    for (const tick of niceTicks(min, max)) {
      const x = xOf(tick);
      gridLines.push({ x1: x, y1: margin.top, x2: x, y2: margin.top + plotHeight });
      tickLabels.push({
        x,
        y: BAR_HEIGHT - 8,
        anchor: 'middle',
        label: formatNumericValue(tick),
      });
    }

    const groupHeight = plotHeight / categories.length;
    const barHeight = Math.min(18, (groupHeight * 0.8) / series.length);

    const bars: BarDatum[] = [];
    for (const [seriesIndex, seriesValues] of values.entries()) {
      for (const [categoryIndex, value] of seriesValues.entries()) {
        const groupStart = margin.top + categoryIndex * groupHeight;
        const y =
          groupStart + groupHeight / 2 - (series.length * barHeight) / 2 + seriesIndex * barHeight;
        const x = Math.min(zeroX, xOf(value));
        const width = Math.max(1, Math.abs(xOf(value) - zeroX));
        bars.push({
          x,
          y,
          width,
          height: Math.max(2, barHeight - 2),
          color: series[seriesIndex]?.color ?? SERIES_COLORS[0]!,
          label: `${categories[categoryIndex]} — ${series[seriesIndex]?.displayName}: ${formatNumericValue(value)}`,
        });
      }
    }

    return {
      bars,
      gridLines,
      tickLabels,
      zeroLine: { x1: zeroX, y1: margin.top, x2: zeroX, y2: margin.top + plotHeight },
      categoryLabels: categories.map((label, index) => ({
        x: margin.left - 6,
        y: margin.top + index * groupHeight + groupHeight / 2 + 3,
        anchor: 'end' as const,
        label: label.length > 11 ? `${label.slice(0, 10)}…` : label,
      })),
    };
  }

  /** One polyline per series over shared category positions. */
  private renderLine(
    categories: string[],
    values: number[][],
    series: { color: string; displayName: string }[],
  ): Pick<RenderedChart, 'lines' | 'gridLines' | 'tickLabels' | 'categoryLabels' | 'zeroLine'> {
    const plotWidth = BAR_WIDTH - BAR_MARGIN.left - BAR_MARGIN.right;
    const plotHeight = BAR_HEIGHT - BAR_MARGIN.top - BAR_MARGIN.bottom;
    if (categories.length === 0 || series.length === 0) {
      return { lines: [], gridLines: [], tickLabels: [], categoryLabels: [], zeroLine: null };
    }

    const all = values.flat();
    const min = Math.min(0, ...all);
    const max = Math.max(0, ...all);
    const range = max - min || 1;
    const yOf = (value: number): number => BAR_MARGIN.top + ((max - value) / range) * plotHeight;
    const axis = this.valueAxis(min, max, yOf);
    const groupWidth = plotWidth / categories.length;
    const xOf = (index: number): number => BAR_MARGIN.left + index * groupWidth + groupWidth / 2;

    const lines: LineSeries[] = values.map((seriesValues, seriesIndex) => ({
      color: series[seriesIndex]?.color ?? SERIES_COLORS[0]!,
      points: seriesValues.map((value, index) => `${xOf(index)},${yOf(value)}`).join(' '),
      markers: seriesValues.map((value, index) => ({
        x: xOf(index),
        y: yOf(value),
        label: `${categories[index]} — ${series[seriesIndex]?.displayName}: ${formatNumericValue(value)}`,
      })),
    }));

    return {
      lines,
      ...axis,
      zeroLine: {
        x1: BAR_MARGIN.left,
        y1: yOf(0),
        x2: BAR_MARGIN.left + plotWidth,
        y2: yOf(0),
      },
      categoryLabels: categories.map((label, index) => ({
        x: xOf(index),
        y: BAR_HEIGHT - 8,
        anchor: 'middle' as const,
        label: label.length > 8 ? `${label.slice(0, 7)}…` : label,
      })),
    };
  }

  /** Horizontal gridlines with value labels on the left, at nice steps. */
  private valueAxis(
    min: number,
    max: number,
    yOf: (value: number) => number,
  ): { gridLines: ChartLine[]; tickLabels: ChartText[] } {
    const gridLines: ChartLine[] = [];
    const tickLabels: ChartText[] = [];
    for (const tick of niceTicks(min, max)) {
      const y = yOf(tick);
      gridLines.push({
        x1: BAR_MARGIN.left,
        y1: y,
        x2: BAR_WIDTH - BAR_MARGIN.right,
        y2: y,
      });
      tickLabels.push({
        x: BAR_MARGIN.left - 6,
        y: y + 3,
        anchor: 'end',
        label: formatNumericValue(tick),
      });
    }
    return { gridLines, tickLabels };
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
