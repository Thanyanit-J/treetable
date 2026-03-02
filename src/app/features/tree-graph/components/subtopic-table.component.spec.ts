import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TableColumn } from '../models/tree-table.model';
import { VisibleSubtopicRow } from '../services/tree-table-store.service';
import { SubtopicTableComponent } from './subtopic-table.component';

const COLUMNS: TableColumn[] = [
  { id: '$Amount', name: 'Amount', type: 'number' },
  { id: '$Rate', name: 'Rate', type: 'number' },
  { id: '$Value', name: 'Value', type: 'number' },
];

function buildRows(valueRaw = '=$Amount*$Rate'): VisibleSubtopicRow[] {
  return [
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
}

describe('SubtopicTableComponent', () => {
  async function nextFrame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function setup(valueRaw = '=$Amount*$Rate'): Promise<{
    fixture: ComponentFixture<SubtopicTableComponent>;
    component: SubtopicTableComponent;
    setCellEvents: Array<{ nodeId: string; columnId: string; raw: string }>;
  }> {
    await TestBed.configureTestingModule({
      imports: [SubtopicTableComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(SubtopicTableComponent);
    fixture.componentRef.setInput('columns', COLUMNS);
    fixture.componentRef.setInput('rows', buildRows(valueRaw));
    fixture.componentRef.setInput('selectedNodeId', null);

    const component = fixture.componentInstance;
    const setCellEvents: Array<{ nodeId: string; columnId: string; raw: string }> = [];
    component.setCell.subscribe((payload) => setCellEvents.push(payload));

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, component, setCellEvents };
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
    await fixture.whenStable();
    fixture.detectChanges();

    expect(valueInput.value).toBe('=$Rate+$Rate');
    expect(valueInput.selectionStart).toBe('=$Rate'.length);
    expect(valueInput.selectionEnd).toBe('=$Rate'.length);
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
});
