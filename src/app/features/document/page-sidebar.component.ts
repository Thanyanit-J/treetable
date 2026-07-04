import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { PageV2 } from '../../core/model/document.model';
import { DocumentStoreService } from '../../core/store/document-store.service';

/**
 * Left pane listing the Document's Pages. Selection-first like everything
 * else: click switches to the page, click again renames inline. Reordering
 * happens only through the hover drag grip; the hover ⋯ menu renames or
 * deletes (deletion is confirmed upstream — it takes the page's cards).
 */
@Component({
  selector: 'app-page-sidebar',
  imports: [CdkDrag, CdkDragHandle, CdkDropList, CdkMenu, CdkMenuItem, CdkMenuTrigger],
  template: `
    <aside class="flex h-full w-44 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div class="px-2 pt-2">
        <button
          type="button"
          class="w-full rounded bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
          (click)="store.addTopic()"
        >
          + Topic
        </button>
      </div>

      <p class="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Pages
      </p>
      <div
        cdkDropList
        class="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        (cdkDropListDropped)="onPageDrop($event)"
      >
        @for (page of store.pages(); track page.id) {
          <div cdkDrag [cdkDragData]="page.id" class="group/page relative">
            @if (renamingPageId() === page.id) {
              <input
                #renameInput
                class="w-full rounded border border-sky-300 px-2 py-1.5 text-sm text-slate-800 focus-visible:outline-none"
                [value]="page.name"
                aria-label="Rename page"
                (blur)="commitRename(page, $event)"
                (keydown.enter)="commitRenameAndBlur(page, $event)"
                (keydown.escape)="cancelRename($event)"
                (contextmenu)="$event.stopPropagation()"
              />
            } @else {
              <button
                type="button"
                class="w-full truncate rounded py-1.5 pl-2 pr-12 text-left text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                [class.bg-sky-100]="isActive(page)"
                [class.text-sky-800]="isActive(page)"
                [class.text-slate-600]="!isActive(page)"
                [attr.aria-current]="isActive(page) ? 'page' : null"
                [attr.aria-label]="
                  'Page ' + page.name + (isActive(page) ? ' (current — click again to rename)' : '')
                "
                (click)="onPageClick(page)"
              >
                {{ page.name }}
              </button>
              <button
                cdkDragHandle
                type="button"
                class="absolute right-6 top-1/2 z-10 flex h-5 w-4 -translate-y-1/2 cursor-grab items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-600 group-hover/page:opacity-100"
                [attr.aria-label]="'Drag to reorder page ' + page.name"
              >
                <span aria-hidden="true" class="text-[10px] leading-none">⠿</span>
              </button>
              <button
                type="button"
                class="absolute right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-600 group-hover/page:opacity-100"
                [cdkMenuTriggerFor]="pageMenu"
                (click)="menuPage.set(page)"
                [attr.aria-label]="'Actions for page ' + page.name"
              >
                <span aria-hidden="true" class="text-xs leading-none">⋯</span>
              </button>
            }
          </div>
        }
      </div>
    </aside>

    <ng-template #pageMenu>
      @if (menuPage(); as page) {
        <div
          cdkMenu
          class="z-50 w-44 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-700 shadow-xl"
        >
          <button
            cdkMenuItem
            type="button"
            class="menu-item"
            (cdkMenuItemTriggered)="beginRename(page)"
          >
            Rename
          </button>
          <button
            cdkMenuItem
            type="button"
            class="menu-item text-rose-700"
            [disabled]="store.pages().length <= 1"
            (cdkMenuItemTriggered)="requestDeletePage.emit(page.id)"
          >
            Delete page
          </button>
        </div>
      }
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
    .menu-item:hover:not(:disabled),
    .menu-item:focus-visible {
      background: var(--color-slate-100);
      outline: none;
    }
    .menu-item:disabled {
      opacity: 0.4;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageSidebarComponent {
  protected readonly store = inject(DocumentStoreService);

  readonly requestDeletePage = output<string>();

  protected readonly renamingPageId = signal<string | null>(null);
  protected readonly menuPage = signal<PageV2 | null>(null);
  private readonly renameInputRef = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  constructor() {
    afterRenderEffect(() => {
      if (this.renamingPageId() !== null) {
        const input = this.renameInputRef()?.nativeElement;
        input?.focus();
        input?.select();
      }
    });
  }

  protected isActive(page: PageV2): boolean {
    return this.store.activePage().id === page.id;
  }

  /** Click switches to the page; a second click on the current page renames. */
  protected onPageClick(page: PageV2): void {
    if (this.isActive(page)) {
      this.renamingPageId.set(page.id);
    } else {
      this.store.selectPage(page.id);
    }
  }

  protected beginRename(page: PageV2): void {
    this.renamingPageId.set(page.id);
  }

  protected commitRename(page: PageV2, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.renamingPageId.set(null);
    this.store.renamePage(page.id, value);
  }

  protected commitRenameAndBlur(page: PageV2, event: Event): void {
    event.preventDefault();
    this.commitRename(page, event);
    (event.target as HTMLInputElement | null)?.blur();
  }

  protected cancelRename(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.renamingPageId.set(null);
  }

  protected onPageDrop(event: CdkDragDrop<unknown>): void {
    if (event.previousIndex !== event.currentIndex) {
      this.store.movePage(event.previousIndex, event.currentIndex);
    }
  }
}
