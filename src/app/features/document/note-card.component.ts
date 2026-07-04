import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NoteCardV2 } from '../../core/model/document.model';
import { DocumentStoreService } from '../../core/store/document-store.service';

/** Free-text card: a borderless strip, a bordered shell, one textarea. */
@Component({
  selector: 'app-note-card',
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger],
  template: `
    <article class="relative flex h-full w-72 min-w-64 shrink-0 flex-col">
      <div class="flex h-7 shrink-0 items-center pl-8 pr-8">
        <span class="text-xs font-semibold text-slate-600">Note</span>
      </div>
      <button
        type="button"
        class="absolute right-1 top-1 z-30 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-sky-600"
        [cdkMenuTriggerFor]="noteMenu"
        aria-label="Actions for note"
      >
        <span aria-hidden="true">⋯</span>
      </button>

      <div class="relative flex min-h-0 flex-1 flex-col border border-slate-200 bg-white shadow-sm">
        @if (isCardFocused()) {
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-y-0 left-0 z-30 w-1 bg-sky-400"
          ></div>
        }
        <textarea
          class="h-full w-full flex-1 resize-none bg-transparent p-3 text-sm text-slate-700 focus-visible:outline-none"
          placeholder="Write anything…"
          aria-label="Note text"
          [value]="card().text"
          (focus)="selectCard()"
          (blur)="commitText($event)"
          (contextmenu)="$event.stopPropagation()"
        ></textarea>
      </div>
    </article>

    <ng-template #noteMenu>
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
          Delete note
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
export class NoteCardComponent {
  protected readonly store = inject(DocumentStoreService);

  readonly card = input.required<NoteCardV2>();
  readonly requestDelete = output<string>();

  protected readonly isCardFocused = computed(
    () => this.store.selection()?.topicId === this.card().id,
  );

  protected selectCard(): void {
    this.store.select({ kind: 'card', topicId: this.card().id });
  }

  protected commitText(event: Event): void {
    this.store.setNoteText(this.card().id, (event.target as HTMLTextAreaElement).value);
  }
}
