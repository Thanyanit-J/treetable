import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TopicEvaluation } from '../../core/engine/formula-evaluator';
import { TopicCardV2 } from '../../core/model/document.model';
import { RefNameTarget } from '../../core/store/document-store.service';
import { ChartPanelComponent } from './chart-panel.component';
import { LatticeComponent } from './lattice/lattice.component';

const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2] as const;

/**
 * Card chrome around one Topic's lattice, owning the per-card viewport:
 * zoom is ephemeral view state (CONTEXT.md) applied via CSS `zoom`, so the
 * whole lattice — tree, table and connectors — scales as one surface
 * (ADR-0001). The lattice measures in layout coordinates, so zoom cannot
 * skew alignment or overlays.
 */
@Component({
  selector: 'app-topic-card',
  imports: [ChartPanelComponent, LatticeComponent],
  template: `
    <article
      #cardRoot
      class="w-max max-w-full shrink-0 rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm"
    >
      <div class="mb-2 mr-8 flex items-center justify-end gap-1">
        <button
          type="button"
          class="zoom-button"
          [attr.aria-expanded]="showCharts()"
          (click)="showCharts.set(!showCharts())"
        >
          Charts{{ chartCount() > 0 ? ' (' + chartCount() + ')' : '' }}
        </button>
        <span class="mx-1 h-4 w-px bg-slate-200" aria-hidden="true"></span>
        <button type="button" class="zoom-button" (click)="fitToCard()">Fit</button>
        <button
          type="button"
          class="zoom-button"
          [disabled]="!canZoom(-1)"
          aria-label="Zoom out"
          (click)="stepZoom(-1)"
        >
          −
        </button>
        <button
          type="button"
          class="zoom-button min-w-12 tabular-nums"
          aria-label="Reset zoom to 100%"
          (click)="zoom.set(1)"
        >
          {{ zoomPercent() }}
        </button>
        <button
          type="button"
          class="zoom-button"
          [disabled]="!canZoom(1)"
          aria-label="Zoom in"
          (click)="stepZoom(1)"
        >
          +
        </button>
      </div>

      <div class="overflow-x-auto">
        <div #zoomSurface [style.zoom]="zoom()">
          <app-lattice
            [topic]="topic()"
            [evaluation]="evaluation()"
            (requestDeleteTopic)="requestDeleteTopic.emit($event)"
            (requestDeleteNode)="requestDeleteNode.emit($event)"
            (requestEditRefName)="requestEditRefName.emit($event)"
            (notify)="notify.emit($event)"
          />
        </div>
      </div>

      @if (showCharts()) {
        <app-chart-panel [topic]="topic()" [evaluation]="evaluation()" />
      }
    </article>
  `,
  styles: `
    .zoom-button {
      border-radius: 0.375rem;
      border: 1px solid var(--color-slate-200);
      background: white;
      padding: 0.125rem 0.5rem;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--color-slate-600);
    }
    .zoom-button:hover:not(:disabled) {
      background: var(--color-slate-50);
    }
    .zoom-button:disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }
    .zoom-button:focus-visible {
      outline: 2px solid var(--color-sky-600);
      outline-offset: 1px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopicCardComponent {
  readonly topic = input.required<TopicCardV2>();
  readonly evaluation = input.required<TopicEvaluation>();

  readonly requestDeleteTopic = output<string>();
  readonly requestDeleteNode = output<{ topicId: string; nodeId: string }>();
  readonly requestEditRefName = output<RefNameTarget>();
  readonly notify = output<string>();

  protected readonly zoom = signal(1);
  protected readonly zoomPercent = computed(() => `${Math.round(this.zoom() * 100)}%`);
  protected readonly showCharts = signal(false);
  protected readonly chartCount = computed(() => this.topic().charts?.length ?? 0);

  private readonly cardRootRef = viewChild.required<ElementRef<HTMLElement>>('cardRoot');
  private readonly zoomSurfaceRef = viewChild.required<ElementRef<HTMLElement>>('zoomSurface');

  protected canZoom(direction: 1 | -1): boolean {
    const index = this.nearestZoomIndex();
    const next = index + direction;
    return next >= 0 && next < ZOOM_LEVELS.length;
  }

  protected stepZoom(direction: 1 | -1): void {
    if (!this.canZoom(direction)) {
      return;
    }
    this.zoom.set(ZOOM_LEVELS[this.nearestZoomIndex() + direction] ?? 1);
  }

  /** Shrinks (never enlarges) the lattice to the card's available width. */
  protected fitToCard(): void {
    const lattice = this.zoomSurfaceRef().nativeElement.firstElementChild as HTMLElement | null;
    const card = this.cardRootRef().nativeElement;
    if (!lattice || lattice.offsetWidth === 0) {
      return;
    }
    const styles = getComputedStyle(card);
    const available =
      card.clientWidth -
      Number.parseFloat(styles.paddingLeft) -
      Number.parseFloat(styles.paddingRight);
    const fit = Math.min(1, available / lattice.offsetWidth);
    this.zoom.set(Math.max(ZOOM_LEVELS[0] ?? 0.25, Math.round(fit * 100) / 100));
  }

  private nearestZoomIndex(): number {
    const current = this.zoom();
    let best = 0;
    for (const [index, level] of ZOOM_LEVELS.entries()) {
      if (Math.abs(level - current) < Math.abs((ZOOM_LEVELS[best] ?? 1) - current)) {
        best = index;
      }
    }
    return best;
  }
}
