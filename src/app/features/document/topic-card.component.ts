import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TopicEvaluation } from '../../core/engine/formula-evaluator';
import { TopicCardV2 } from '../../core/model/document.model';
import { DocumentStoreService } from '../../core/store/document-store.service';
import { ChartPanelComponent } from './chart-panel.component';
import { LatticeComponent } from './lattice/lattice.component';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;

/**
 * Card chrome around one Topic's lattice. Edge-to-edge (no padding), a ⋯
 * menu at the top right, and gesture zoom: Ctrl+wheel — which is also what
 * trackpad pinch delivers — zooms just this card. Zoom is ephemeral view
 * state applied via CSS `zoom`, so tree, table and connectors scale as one
 * surface (ADR-0001); the lattice measures in layout coordinates, so zoom
 * cannot skew alignment or overlays. Card properties are edited by selecting
 * the card (click its root pill or blank area) and using the Inspector.
 */
@Component({
  selector: 'app-topic-card',
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger, ChartPanelComponent, LatticeComponent],
  template: `
    <article
      #cardRoot
      class="relative flex h-full min-w-64 shrink-0 flex-col border-r border-slate-200 bg-white"
      [class.ring-2]="isCardSelected()"
      [class.ring-inset]="isCardSelected()"
      [class.ring-sky-400]="isCardSelected()"
      (click)="onCardClick($event)"
      (wheel)="onWheel($event)"
    >
      <!-- Chrome strip: reserves space so the ⋯ menu and the page-level drag
           handle sit above the lattice/chart content instead of overlapping it. -->
      <div
        class="h-7 shrink-0 border-b border-slate-100"
        (click)="store.select({ kind: 'card', topicId: topic().id })"
      ></div>
      <button
        type="button"
        class="absolute right-1 top-1 z-30 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-sky-600"
        [cdkMenuTriggerFor]="cardMenu"
        [attr.aria-label]="'Actions for topic ' + topic().displayName"
      >
        <span aria-hidden="true">⋯</span>
      </button>

      <div class="flex-1 overflow-auto">
        <div #zoomSurface [style.zoom]="zoom()">
          <app-lattice
            [topic]="topic()"
            [evaluation]="evaluation()"
            (requestDeleteTopic)="requestDeleteTopic.emit($event)"
            (requestDeleteNode)="requestDeleteNode.emit($event)"
            (notify)="notify.emit($event)"
          />
        </div>
      </div>

      @if (showCharts()) {
        <div class="px-2 pb-2">
          <app-chart-panel [topic]="topic()" [evaluation]="evaluation()" />
        </div>
      }
    </article>

    <ng-template #cardMenu>
      <div
        cdkMenu
        class="z-50 w-52 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-700 shadow-xl"
      >
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="store.addChildNode(topic().id, null)"
        >
          Add node
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="showCharts.set(!showCharts())"
        >
          {{ showCharts() ? 'Hide charts' : 'Show charts'
          }}{{ chartCount() > 0 ? ' (' + chartCount() + ')' : '' }}
        </button>
        <button cdkMenuItem type="button" class="menu-item" (cdkMenuItemTriggered)="fitToCard()">
          Fit to width
        </button>
        <button cdkMenuItem type="button" class="menu-item" (cdkMenuItemTriggered)="zoom.set(1)">
          Reset zoom ({{ zoomPercent() }})
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item text-rose-700"
          (cdkMenuItemTriggered)="requestDeleteTopic.emit(topic().id)"
        >
          Delete topic
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
export class TopicCardComponent {
  protected readonly store = inject(DocumentStoreService);

  readonly topic = input.required<TopicCardV2>();
  readonly evaluation = input.required<TopicEvaluation>();

  readonly requestDeleteTopic = output<string>();
  readonly requestDeleteNode = output<{ topicId: string; nodeId: string }>();
  readonly notify = output<string>();

  protected readonly zoom = signal(1);
  protected readonly zoomPercent = computed(() => `${Math.round(this.zoom() * 100)}%`);
  protected readonly showCharts = signal(false);
  protected readonly chartCount = computed(() => this.topic().charts?.length ?? 0);
  protected readonly isCardSelected = computed(() => {
    const selection = this.store.selection();
    return selection?.kind === 'card' && selection.topicId === this.topic().id;
  });

  private readonly cardRootRef = viewChild.required<ElementRef<HTMLElement>>('cardRoot');
  private readonly zoomSurfaceRef = viewChild.required<ElementRef<HTMLElement>>('zoomSurface');

  /** Clicking blank card area selects the card for the Inspector. */
  protected onCardClick(event: MouseEvent): void {
    if (
      event.target === event.currentTarget ||
      event.target === this.zoomSurfaceRef().nativeElement
    ) {
      this.store.select({ kind: 'card', topicId: this.topic().id });
    }
  }

  /** Ctrl+wheel (or trackpad pinch, which browsers deliver the same way) zooms this card only. */
  protected onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom() * factor));
    this.zoom.set(Math.round(next * 100) / 100);
  }

  /** Shrinks (never enlarges) the lattice to the card's available width. */
  protected fitToCard(): void {
    const lattice = this.zoomSurfaceRef().nativeElement.firstElementChild as HTMLElement | null;
    const card = this.cardRootRef().nativeElement;
    if (!lattice || lattice.offsetWidth === 0) {
      return;
    }
    const fit = Math.min(1, card.clientWidth / lattice.offsetWidth);
    this.zoom.set(Math.max(MIN_ZOOM, Math.round(fit * 100) / 100));
  }
}
