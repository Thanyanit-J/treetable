import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { PageV2, isTopicCard } from '../../core/model/document.model';
import { DocumentStoreService } from '../../core/store/document-store.service';

/**
 * Left pane listing the Document's Pages. Selection-first like everything
 * else: click switches to the page, click again renames inline. Reordering
 * happens only through the hover drag grip; the hover ⋯ menu renames or
 * deletes (deletion is confirmed upstream — it takes the page's cards).
 */
@Component({
  selector: 'app-page-sidebar',
  imports: [
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    CdkMenu,
    CdkMenuItem,
    CdkMenuTrigger,
    NgTemplateOutlet,
  ],
  template: `
    <aside
      class="relative h-full shrink-0 border-r border-slate-200 bg-white"
      [style.width.px]="collapsed() ? 44 : panelWidth()"
      (pointerenter)="onAsideEnter()"
      (pointerleave)="onAsideLeave()"
    >
      @if (!collapsed()) {
        <ng-container [ngTemplateOutlet]="panelContent" />
        <button
          type="button"
          class="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-sky-200/70 focus-visible:bg-sky-300/70 focus-visible:outline-none"
          aria-label="Resize pages panel (drag, or arrow keys; double-click resets)"
          (pointerdown)="startPanelResize($event)"
          (keydown.arrowleft)="nudgePanelWidth($event, -16)"
          (keydown.arrowright)="nudgePanelWidth($event, 16)"
          (dblclick)="panelWidth.set(defaultWidth)"
        ></button>
      } @else {
        <!-- Mini rail: one icon per row, at the exact vertical positions the
             expanded rows occupy, so peeking/expanding never shifts them. -->
        <div class="flex h-full flex-col">
          <div class="px-2 pt-2">
            <button
              type="button"
              class="flex h-7 w-full items-center justify-center rounded bg-sky-600 text-sm font-semibold text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
              [cdkMenuTriggerFor]="addMenu"
              aria-label="Add new"
            >
              +
            </button>
          </div>
          <div class="h-8" aria-hidden="true"></div>
          <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            @for (page of store.pages(); track page.id) {
              <button
                type="button"
                class="flex h-8 w-full items-center justify-center rounded text-xs font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                [class.bg-sky-100]="isActive(page)"
                [class.text-sky-800]="isActive(page)"
                [class.text-slate-500]="!isActive(page)"
                [attr.aria-current]="isActive(page) ? 'page' : null"
                [attr.aria-label]="'Page ' + page.name"
                (click)="store.selectPage(page.id)"
              >
                {{ pageInitial(page) }}
              </button>
            }
          </div>
        </div>
        @if (peek()) {
          <!-- Hover peek floats over the content area; nothing gets pushed. -->
          <div
            class="absolute inset-y-0 left-0 z-40 border-r border-slate-200 bg-white shadow-xl"
            [style.width.px]="panelWidth()"
          >
            <ng-container [ngTemplateOutlet]="panelContent" />
          </div>
        }
      }
    </aside>

    <ng-template #panelContent>
      <div class="flex h-full flex-col">
        <div class="px-2 pt-2">
          <button
            type="button"
            class="flex h-7 w-full items-center justify-center rounded bg-sky-600 px-2.5 text-xs font-semibold text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
            [cdkMenuTriggerFor]="addMenu"
            (cdkMenuOpened)="onMenuOpened()"
            (cdkMenuClosed)="onMenuClosed()"
          >
            + Add new
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
                    'Page ' +
                    page.name +
                    (isActive(page) ? ' (current — click again to rename)' : '')
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
                  (cdkMenuOpened)="onMenuOpened()"
                  (cdkMenuClosed)="onMenuClosed()"
                  (click)="menuPage.set(page)"
                  [attr.aria-label]="'Actions for page ' + page.name"
                >
                  <span aria-hidden="true" class="text-xs leading-none">⋯</span>
                </button>
              }
            </div>
          }
        </div>
      </div>
    </ng-template>

    <ng-template #addMenu>
      <div
        cdkMenu
        class="z-50 w-48 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-700 shadow-xl"
      >
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="createKind.set('topic')"
        >
          New tree-table…
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="createKind.set('table')"
        >
          New table…
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="store.addNote()"
        >
          New text note
        </button>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          [disabled]="topicOptions().length === 0"
          (cdkMenuItemTriggered)="chartDialogOpen.set(true)"
        >
          New charts…
        </button>
        <div class="my-1 border-t border-slate-200" role="separator"></div>
        <button
          cdkMenuItem
          type="button"
          class="menu-item"
          (cdkMenuItemTriggered)="store.addPage()"
        >
          Add page
        </button>
      </div>
    </ng-template>

    <dialog
      #createDialog
      class="m-auto w-[min(22rem,90vw)] rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-900/40"
      (close)="createKind.set(null)"
    >
      <form class="p-5" (submit)="confirmCreate($event)">
        <h2 class="text-base font-semibold text-slate-900">
          {{ createKind() === 'table' ? 'New table' : 'New tree-table' }}
        </h2>
        <label class="mt-3 block text-xs font-medium text-slate-500">
          Name
          <input
            #createName
            class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-600"
            [attr.placeholder]="createKind() === 'table' ? 'New Table' : 'New Topic'"
          />
        </label>
        <p class="mt-2 text-xs text-slate-400">
          {{
            createKind() === 'table'
              ? 'A table is a tree-table without the tree — rows only.'
              : 'The root node shares this name until renamed.'
          }}
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="dialog-secondary" (click)="createKind.set(null)">
            Cancel
          </button>
          <button type="submit" class="dialog-primary">Create</button>
        </div>
      </form>
    </dialog>

    <dialog
      #chartDialog
      class="m-auto w-[min(22rem,90vw)] rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-900/40"
      (close)="chartDialogOpen.set(false)"
    >
      <form class="p-5" (submit)="confirmChartCard($event)">
        <h2 class="text-base font-semibold text-slate-900">New charts card</h2>
        <label class="mt-3 block text-xs font-medium text-slate-500">
          Chart the data of
          <select
            #chartSource
            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-600"
          >
            @for (topic of topicOptions(); track topic.id) {
              <option [value]="topic.id">{{ topic.cardTitle ?? topic.displayName }}</option>
            }
          </select>
        </label>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="dialog-secondary" (click)="chartDialogOpen.set(false)">
            Cancel
          </button>
          <button type="submit" class="dialog-primary">Create</button>
        </div>
      </form>
    </dialog>

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
    .dialog-primary {
      border-radius: 0.5rem;
      background: var(--color-sky-600);
      padding: 0.375rem 0.75rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: white;
    }
    .dialog-primary:hover {
      background: var(--color-sky-500);
    }
    .dialog-secondary {
      border-radius: 0.5rem;
      border: 1px solid var(--color-slate-300);
      background: white;
      padding: 0.375rem 0.75rem;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-slate-700);
    }
    .dialog-secondary:hover {
      background: var(--color-slate-50);
    }
    button:focus-visible {
      outline: 2px solid var(--color-sky-600);
      outline-offset: 1px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageSidebarComponent {
  protected readonly store = inject(DocumentStoreService);

  /** Collapsed = mini icon rail; hovering peeks the full panel as an overlay. */
  readonly collapsed = input(false);
  readonly requestDeletePage = output<string>();

  protected readonly defaultWidth = 176;
  /** Ephemeral view state, adjustable by dragging the right border. */
  protected readonly panelWidth = signal(this.defaultWidth);
  protected readonly peek = signal(false);
  protected readonly renamingPageId = signal<string | null>(null);
  protected readonly menuPage = signal<PageV2 | null>(null);
  protected readonly createKind = signal<'topic' | 'table' | null>(null);
  protected readonly chartDialogOpen = signal(false);
  protected readonly topicOptions = computed(() => this.store.cards().filter(isTopicCard));

  private readonly renameInputRef = viewChild<ElementRef<HTMLInputElement>>('renameInput');
  private readonly createDialogRef = viewChild<ElementRef<HTMLDialogElement>>('createDialog');
  private readonly createNameRef = viewChild<ElementRef<HTMLInputElement>>('createName');
  private readonly chartDialogRef = viewChild<ElementRef<HTMLDialogElement>>('chartDialog');
  private readonly chartSourceRef = viewChild<ElementRef<HTMLSelectElement>>('chartSource');

  constructor() {
    afterRenderEffect(() => {
      if (this.renamingPageId() !== null) {
        const input = this.renameInputRef()?.nativeElement;
        input?.focus();
        input?.select();
      }
    });

    effect(() => {
      const dialog = this.createDialogRef()?.nativeElement;
      if (!dialog) {
        return;
      }
      if (this.createKind() !== null) {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });

    effect(() => {
      const dialog = this.chartDialogRef()?.nativeElement;
      if (!dialog) {
        return;
      }
      if (this.chartDialogOpen()) {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });
  }

  protected confirmCreate(event: Event): void {
    event.preventDefault();
    const kind = this.createKind();
    const input = this.createNameRef()?.nativeElement;
    if (!kind) {
      return;
    }
    const name = (input?.value ?? '').trim();
    if (kind === 'table') {
      this.store.addTable(name || 'New Table');
    } else {
      this.store.addTopic(name || 'New Topic');
    }
    if (input) {
      input.value = '';
    }
    this.createKind.set(null);
  }

  protected confirmChartCard(event: Event): void {
    event.preventDefault();
    const sourceId = this.chartSourceRef()?.nativeElement.value;
    if (sourceId) {
      this.store.addChartCard(sourceId);
    }
    this.chartDialogOpen.set(false);
  }

  protected isActive(page: PageV2): boolean {
    return this.store.activePage().id === page.id;
  }

  protected pageInitial(page: PageV2): string {
    const first = page.name.trim().charAt(0);
    return first === '' ? '?' : first.toUpperCase();
  }

  private readonly hoveringAside = signal(false);
  /** Open menus triggered from the peek — it must outlive them (their triggers live in it). */
  private readonly openMenuCount = signal(0);

  protected onAsideEnter(): void {
    this.hoveringAside.set(true);
    if (this.collapsed()) {
      this.peek.set(true);
    }
  }

  protected onMenuOpened(): void {
    this.openMenuCount.update((count) => count + 1);
  }

  protected onMenuClosed(): void {
    this.openMenuCount.update((count) => Math.max(0, count - 1));
    // The pointer usually left the aside while the menu was up; catch up now.
    if (this.openMenuCount() === 0 && !this.hoveringAside() && this.renamingPageId() === null) {
      this.peek.set(false);
    }
  }

  protected startPanelResize(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released.
    }
    const startX = event.clientX;
    const startWidth = this.panelWidth();
    const onMove = (moveEvent: PointerEvent): void => {
      this.panelWidth.set(this.clampWidth(startWidth + (moveEvent.clientX - startX)));
    };
    const cleanup = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', cleanup);
      handle.removeEventListener('pointercancel', cleanup);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', cleanup);
    handle.addEventListener('pointercancel', cleanup);
  }

  protected nudgePanelWidth(event: Event, delta: number): void {
    event.preventDefault();
    this.panelWidth.set(this.clampWidth(this.panelWidth() + delta));
  }

  private clampWidth(width: number): number {
    return Math.min(400, Math.max(140, Math.round(width)));
  }

  /** A rename or open menu in the peek overlay keeps it open. */
  protected onAsideLeave(): void {
    this.hoveringAside.set(false);
    if (this.renamingPageId() === null && this.openMenuCount() === 0) {
      this.peek.set(false);
    }
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
