import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TopicEvaluation } from '../../core/engine/formula-evaluator';
import { TopicCardV2 } from '../../core/model/document.model';
import { LatticeComponent } from './lattice/lattice.component';

/**
 * Card chrome around one Topic's lattice. The chart panel will join it in a
 * later milestone; keeping the wrapper thin but present preserves that seam.
 */
@Component({
  selector: 'app-topic-card',
  imports: [LatticeComponent],
  template: `
    <article
      class="w-max max-w-full shrink-0 overflow-x-auto rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm"
    >
      <app-lattice
        [topic]="topic()"
        [evaluation]="evaluation()"
        (requestDeleteTopic)="requestDeleteTopic.emit($event)"
        (requestDeleteNode)="requestDeleteNode.emit($event)"
        (notify)="notify.emit($event)"
      />
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopicCardComponent {
  readonly topic = input.required<TopicCardV2>();
  readonly evaluation = input.required<TopicEvaluation>();

  readonly requestDeleteTopic = output<string>();
  readonly requestDeleteNode = output<{ topicId: string; nodeId: string }>();
  readonly notify = output<string>();
}
