import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TableColumn } from '../models/tree-table.model';
import { VisibleSubtopicRow } from '../services/tree-table-store.service';
import { SubtopicTableComponent } from './subtopic-table.component';

const COLUMNS: TableColumn[] = [
  { id: '$Amount', name: 'Amount', type: 'number' },
  { id: '$Rate', name: 'Rate', type: 'number' },
  { id: '$Value', name: 'Value', type: 'number' },
];

function buildRows(valueRaw = '=$Amount*$Rate', includeSecondRow = false): VisibleSubtopicRow[] {
  const rows: VisibleSubtopicRow[] = [
    {
      topicId: 'topic_1',
      topicLabel: 'Topic 1',
      subtopic: {
        id: 'subtopic_1',
        topicId: 'topic_1',
        label: 'Subtopic 1',
        cells: {
          $Amount: { raw: '100', value: 100, error: null },
          $Rate: { raw: '0.1', value: 0.1, error: null },
          $Value: { raw: valueRaw, value: 10, error: null },
        },
      },
    },
  ];

  if (includeSecondRow) {
    rows.push({
      topicId: 'topic_1',
      topicLabel: 'Topic 1',
      subtopic: {
        id: 'subtopic_2',
        topicId: 'topic_1',
        label: 'Subtopic 2',
        cells: {
          $Amount: { raw: '250', value: 250, error: null },
          $Rate: { raw: '0.2', value: 0.2, error: null },
          $Value: { raw: valueRaw, value: 50, error: null },
        },
      },
    });
  }

  return rows;
}

describe('SubtopicTableComponent', () => {
  async function nextFrame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function nextMacrotask(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  async function setup(valueRaw = '=$Amount*$Rate', includeSecondRow = false): Promise<{
    fixture: ComponentFixture<SubtopicTableComponent>;
    component: SubtopicTableComponent;
    setCellEvents: Array<{ nodeId: string; columnId: string; raw: string }>;
    renameColumnEvents: Array<{ columnId: string; name: string }>;
    selectNodeEvents: Array<string | null>;
  }> {
    await TestBed.configureTestingModule({
      imports: [SubtopicTableComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(SubtopicTableComponent);
    fixture.componentRef.setInput('columns', COLUMNS);
    fixture.componentRef.setInput('rows', buildRows(valueRaw, includeSecondRow));
    fixture.componentRef.setInput('selectedNodeId', null);

    const component = fixture.componentInstance;
    const setCellEvents: Array<{ nodeId: string; columnId: string; raw: string }> = [];
    const renameColumnEvents: Array<{ columnId: string; name: string }> = [];
    const selectNodeEvents: Array<string | null> = [];
    component.setCell.subscribe((payload) => setCellEvents.push(payload));
    component.renameColumn.subscribe((payload) => renameColumnEvents.push(payload));
    component.selectNode.subscribe((payload) => selectNodeEvents.push(payload));

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, component, setCellEvents, renameColumnEvents, selectNodeEvents };
  }

  function getCellInput(fixture: ComponentFixture<SubtopicTableComponent>, nodeId: string, columnId: string): HTMLInputElement {
    const input = fixture.nativeElement.querySelector(
      `input[data-cell-key="${nodeId}:${columnId}"]`,
    ) as HTMLInputElement | null;

    if (!input) {
      throw new Error(`Missing input for ${nodeId}:${columnId}`);
    }

    return input;
  }

  function focusInput(fixture: ComponentFixture<SubtopicTableComponent>, input: HTMLInputElement): void {
    input.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
  }

  function headerRenameInput(fixture: ComponentFixture<SubtopicTableComponent>): HTMLInputElement | null {
    return fixture.nativeElement.querySelector('thead input[data-column-rename-id]') as HTMLInputElement | null;
  }

  it('enters editing on first focus and shows raw formula', async () => {
    const { fixture } = await setup('=$Amount*$Rate');

    const valueInput = getCellInput(fixture, 'subtopic_1', '$Value');
    expect(valueInput.value).toBe('10');

    focusInput(fixture, valueInput);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(valueInput.value).toBe('=$Amount*$Rate');
  });

  it('inserts a single column reference during formula assist and keeps active edit cell', async () => {
    const { fixture, component } = await setup('=');

    const valueInput = getCellInput(fixture, 'subtopic_1', '$Value');
    focusInput(fixture, valueInput);
    await fixture.whenStable();
    fixture.detectChanges();

    valueInput.setSelectionRange(1, 1);
    const amountInput = getCellInput(fixture, 'subtopic_1', '$Amount');
    amountInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(valueInput.value).toBe('=$Amount');
    expect(valueInput.value.match(/\$Amount/g)?.length ?? 0).toBe(1);
    expect(component.isEditingCell('subtopic_1', '$Value')).toBe(true);
    expect(component.isEditingCell('subtopic_1', '$Amount')).toBe(false);
  });

  it('replaces referenced token at cursor and places caret at inserted token end', async () => {
    const { fixture } = await setup('=$Amount+$Rate');

    const valueInput = getCellInput(fixture, 'subtopic_1', '$Value');
    focusInput(fixture, valueInput);
    await fixture.whenStable();
    fixture.detectChanges();

    valueInput.setSelectionRange(3, 3);
    const rateInput = getCellInput(fixture, 'subtopic_1', '$Rate');
    rateInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    await nextFrame();
    await nextMacrotask();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(valueInput.value).toBe('=$Rate+$Rate');
    expect(valueInput.selectionStart).toBe('=$Rate'.length);
    expect(valueInput.selectionEnd).toBe('=$Rate'.length);
  });

  it('clicking same column header during formula edit does nothing and keeps current cell editing', async () => {
    const { fixture, component } = await setup('=$Amount+$Rate');
    const valueInput = getCellInput(fixture, 'subtopic_1', '$Value');
    focusInput(fixture, valueInput);
    await fixture.whenStable();
    fixture.detectChanges();

    const valueHeader = fixture.nativeElement.querySelectorAll('thead th')[2] as HTMLElement | null;
    valueHeader?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    valueHeader?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(valueInput.value).toBe('=$Amount+$Rate');
    expect(component.isEditingCell('subtopic_1', '$Value')).toBe(true);
  });

  it('clicking another row in same column commits current formula and starts editing clicked cell', async () => {
    const { fixture, component, setCellEvents } = await setup('=$Amount+$Rate', true);
    const firstValueInput = getCellInput(fixture, 'subtopic_1', '$Value');
    const secondValueInput = getCellInput(fixture, 'subtopic_2', '$Value');

    focusInput(fixture, firstValueInput);
    await fixture.whenStable();
    fixture.detectChanges();

    firstValueInput.value = '=$Amount*3';
    firstValueInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    secondValueInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    secondValueInput.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    expect(setCellEvents).toContainEqual({ nodeId: 'subtopic_1', columnId: '$Value', raw: '=$Amount*3' });
    expect(component.isEditingCell('subtopic_1', '$Value')).toBe(false);
    expect(component.isEditingCell('subtopic_2', '$Value')).toBe(true);
  });

  it('commits once on Enter and exits editing', async () => {
    const { fixture, component, setCellEvents } = await setup('=$Amount*$Rate');

    const amountInput = getCellInput(fixture, 'subtopic_1', '$Amount');
    focusInput(fixture, amountInput);
    await fixture.whenStable();
    fixture.detectChanges();

    amountInput.value = '200';
    amountInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    amountInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(setCellEvents).toHaveLength(1);
    expect(setCellEvents[0]).toEqual({ nodeId: 'subtopic_1', columnId: '$Amount', raw: '200' });
    expect(component.isEditingCell('subtopic_1', '$Amount')).toBe(false);
  });

  it('cancels on Escape and blur does not commit', async () => {
    const { fixture, setCellEvents } = await setup('=$Amount*$Rate');

    const amountInput = getCellInput(fixture, 'subtopic_1', '$Amount');
    focusInput(fixture, amountInput);
    await fixture.whenStable();
    fixture.detectChanges();

    amountInput.value = '999';
    amountInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    amountInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    amountInput.dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(setCellEvents).toHaveLength(0);
    expect(amountInput.value).toBe('100');
  });

  it('commits on outside-table mousedown', async () => {
    const { fixture, setCellEvents } = await setup('=$Amount*$Rate');

    const amountInput = getCellInput(fixture, 'subtopic_1', '$Amount');
    focusInput(fixture, amountInput);
    await fixture.whenStable();
    fixture.detectChanges();

    amountInput.value = '300';
    amountInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();

    expect(setCellEvents).toHaveLength(1);
    expect(setCellEvents[0]).toEqual({ nodeId: 'subtopic_1', columnId: '$Amount', raw: '300' });
  });

  it('shows column ids in headers only during formula editing mode', async () => {
    const { fixture } = await setup('=$Amount*$Rate');

    const headerLabelButtons = () =>
      Array.from(fixture.nativeElement.querySelectorAll('th button.truncate')) as HTMLButtonElement[];

    expect(headerLabelButtons()[0]?.textContent?.trim()).toBe('Amount');

    const amountInput = getCellInput(fixture, 'subtopic_1', '$Amount');
    focusInput(fixture, amountInput);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(headerLabelButtons()[0]?.textContent?.trim()).toBe('Amount');

    const valueInput = getCellInput(fixture, 'subtopic_1', '$Value');
    focusInput(fixture, valueInput);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(headerLabelButtons()[0]?.textContent?.trim()).toBe('$Amount');
  });

  it('tracks referenced token at cursor for active formula cell', async () => {
    const { fixture } = await setup('=$Amount+$Rate');

    const valueInput = getCellInput(fixture, 'subtopic_1', '$Value');
    focusInput(fixture, valueInput);
    await fixture.whenStable();
    fixture.detectChanges();

    valueInput.setSelectionRange(3, 3);
    valueInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();

    const firstHeader = fixture.nativeElement.querySelector('thead th') as HTMLElement | null;
    expect(firstHeader?.className).toContain('border-sky-400');
  });

  it('focuses rename textbox immediately when column rename starts', async () => {
    const { fixture } = await setup();

    const renameTrigger = fixture.nativeElement.querySelector('th button.truncate') as HTMLButtonElement | null;
    expect(renameTrigger).toBeTruthy();
    renameTrigger?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    await nextFrame();
    fixture.detectChanges();

    const renameInput = headerRenameInput(fixture);
    expect(renameInput).toBeTruthy();
    expect(document.activeElement).toBe(renameInput);
  });

  it('commits header rename on Enter and cancels on Escape', async () => {
    const { fixture, renameColumnEvents } = await setup();

    const renameTrigger = fixture.nativeElement.querySelector('th button.truncate') as HTMLButtonElement | null;
    renameTrigger?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await nextFrame();
    fixture.detectChanges();

    const renameInput = headerRenameInput(fixture);
    expect(renameInput).toBeTruthy();
    if (!renameInput) {
      return;
    }
    renameInput.value = 'Principal';
    renameInput.dispatchEvent(new Event('input', { bubbles: true }));
    renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(renameColumnEvents).toHaveLength(1);
    expect(renameColumnEvents[0]).toEqual({ columnId: '$Amount', name: 'Principal' });

    const renameTrigger2 = fixture.nativeElement.querySelector('th button.truncate') as HTMLButtonElement | null;
    renameTrigger2?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await nextFrame();
    fixture.detectChanges();

    const renameInput2 = headerRenameInput(fixture);
    expect(renameInput2).toBeTruthy();
    if (!renameInput2) {
      return;
    }
    renameInput2.value = 'Ignored';
    renameInput2.dispatchEvent(new Event('input', { bubbles: true }));
    renameInput2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    renameInput2.dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();

    expect(renameColumnEvents).toHaveLength(1);
  });

  it('clears selection highlight when focus leaves table', async () => {
    const { fixture, selectNodeEvents } = await setup();
    const amountInput = getCellInput(fixture, 'subtopic_1', '$Amount');

    focusInput(fixture, amountInput);
    expect(selectNodeEvents).toContain('subtopic_1');

    amountInput.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
    fixture.detectChanges();

    expect(selectNodeEvents).toContain(null);
  });
});
