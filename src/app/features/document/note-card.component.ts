import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NoteCardV2 } from '../../core/model/document.model';
import { DocumentStoreService } from '../../core/store/document-store.service';
import { renderMarkdown } from './markdown';

/**
 * Free-text card: a borderless strip, a bordered shell, one textarea. In
 * markdown format the card shows the rendered text instead; selection-first
 * like everything else — the first click selects the card, the second drops
 * into the textarea to edit the source.
 */
@Component({
  selector: 'app-note-card',
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger],
  template: `
    <article class="relative flex h-full w-72 min-w-64 shrink-0 flex-col">
      <div class="flex h-7 shrink-0 items-center pl-2 pr-8">
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
        @if (showRendered()) {
          <div
            class="note-markdown h-full w-full flex-1 cursor-text overflow-auto p-3 text-sm text-slate-700"
            tabindex="0"
            [attr.aria-label]="
              'Note (markdown)' + (cardSelected() ? ' — press Enter or click again to edit' : '')
            "
            (click)="onRenderedClick($event)"
            (keydown.enter)="editing.set(true)"
            [innerHTML]="renderedHtml()"
          ></div>
        } @else {
          <textarea
            #noteInput
            class="h-full w-full flex-1 resize-none bg-transparent p-3 text-sm text-slate-700 focus-visible:outline-none"
            [placeholder]="isMarkdown() ? 'Write markdown…' : 'Write anything…'"
            aria-label="Note text"
            [value]="card().text"
            (focus)="selectCard()"
            (blur)="commitText($event)"
            (contextmenu)="$event.stopPropagation()"
          ></textarea>
        }
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

  protected readonly editing = signal(false);
  private readonly noteInputRef = viewChild<ElementRef<HTMLTextAreaElement>>('noteInput');

  protected readonly isCardFocused = computed(
    () => this.store.selection()?.topicId === this.card().id,
  );
  protected readonly cardSelected = computed(() => {
    const selection = this.store.selection();
    return selection?.kind === 'card' && selection.topicId === this.card().id;
  });
  protected readonly isMarkdown = computed(() => (this.card().format ?? 'text') === 'markdown');
  /** Empty markdown falls back to the textarea so there is something to click into. */
  protected readonly showRendered = computed(
    () => this.isMarkdown() && !this.editing() && this.card().text.trim().length > 0,
  );
  protected readonly renderedHtml = computed(() => renderMarkdown(this.card().text));

  constructor() {
    afterRenderEffect(() => {
      if (this.editing()) {
        this.noteInputRef()?.nativeElement.focus();
      }
    });
  }

  /** First click selects the card; a second click opens the markdown source. */
  protected onRenderedClick(event: MouseEvent): void {
    if ((event.target as HTMLElement | null)?.closest('a')) {
      return; // Links keep working inside the rendered view.
    }
    if (this.cardSelected()) {
      this.editing.set(true);
    } else {
      this.selectCard();
    }
  }

  protected selectCard(): void {
    this.store.select({ kind: 'card', topicId: this.card().id });
  }

  protected commitText(event: Event): void {
    this.editing.set(false);
    this.store.setNoteText(this.card().id, (event.target as HTMLTextAreaElement).value);
  }
}
