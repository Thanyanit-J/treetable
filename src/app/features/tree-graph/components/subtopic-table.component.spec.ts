import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TreeTopic } from '../models/tree-table.model';
import { SubtopicTableComponent } from './subtopic-table.component';

function buildTopic(
  valueRaw = '=$Amount*$Rate',
  includeSecondRow = false,
  amountSummaryMode: 'none' | 'sum' = 'none',
): TreeTopic {
  const topic: TreeTopic = {
    id: 'topic_1',
    label: 'Topic 1',
    columns: [
      { id: '$Amount', name: 'Amount', type: 'number', summaryMode: amountSummaryMode },
      { id: '$Rate', name: 'Rate', type: 'number', summaryMode: 'none' },
      { id: '$Value', name: 'Value', type: 'number', summaryMode: 'none' },
    ],
    children: [
      {
        id: 'node_1',
        topicId: 'topic_1',
        label: 'Node 1',
        children: [],
        cells: {
          $Amount: { raw: '100', value: 100, error: null },
          $Rate: { raw: '0.1', value: 0.1, error: null },
          $Value: { raw: valueRaw, value: 10, error: null },
        },
      },
    ],
  };

  if (includeSecondRow) {
    topic.children.push({
      id: 'node_2',
      topicId: 'topic_1',
      label: 'Node 2',
      children: [],
      cells: {
        $Amount: { raw: '250', value: 250, error: null },
        $Rate: { raw: '0.2', value: 0.2, error: null },
        $Value: { raw: valueRaw, value: 50, error: null },
      },
    });
  }

  return topic;
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function nextMacrotask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function setup(
  valueRaw = '=$Amount*$Rate',
  includeSecondRow = false,
  amountSummaryMode: 'none' | 'sum' = 'none',
): Promise<{
  fixture: ComponentFixture<SubtopicTableComponent>;
  component: SubtopicTableComponent;
  setCellEvents: Array<{ topicId: string; nodeId: string; columnId: string; raw: string }>;
  renameColumnEvents: Array<{ topicId: string; columnId: string; name: string }>;
  setColumnSummaryEvents: Array<{ topicId: string; columnId: string; mode: 'none' | 'sum' }>;
  selectNodeEvents: Array<string | null>;
}> {
  await TestBed.configureTestingModule({
    imports: [SubtopicTableComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(SubtopicTableComponent);
  fixture.componentRef.setInput('topic', buildTopic(valueRaw, includeSecondRow, amountSummaryMode));
  fixture.componentRef.setInput('selectedNodeId', null);

  const component = fixture.componentInstance;
  const setCellEvents: Array<{ topicId: string; nodeId: string; columnId: string; raw: string }> = [];
  const renameColumnEvents: Array<{ topicId: string; columnId: string; name: string }> = [];
  const setColumnSummaryEvents: Array<{ topicId: string; columnId: string; mode: 'none' | 'sum' }> = [];
  const selectNodeEvents: Array<string | null> = [];
  component.setCell.subscribe((payload) => setCellEvents.push(payload));
  component.renameColumn.subscribe((payload) => renameColumnEvents.push(payload));
  component.setColumnSummary.subscribe((payload) => setColumnSummaryEvents.push(payload));
  component.selectNode.subscribe((payload) => selectNodeEvents.push(payload));

  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, component, setCellEvents, renameColumnEvents, setColumnSummaryEvents, selectNodeEvents };
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

function headerRenameInputs(fixture: ComponentFixture<SubtopicTableComponent>): HTMLInputElement[] {
  const root = fixture.nativeElement as HTMLElement;
  return Array.from(root.querySelectorAll('thead input[data-column-rename-id]')).filter(
    (element): element is HTMLInputElement => element instanceof HTMLInputElement,
  );
}

function findMenuButtonByText(fixture: ComponentFixture<SubtopicTableComponent>, text: string): HTMLButtonElement {
  const buttons = Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('section[aria-label="Column actions"] button'),
  ).filter((item): item is HTMLButtonElement => item instanceof HTMLButtonElement);
  const target = buttons.find((button) => button.textContent?.trim() === text);
  if (!target) {
    throw new Error(`Missing menu button: ${text}`);
  }
  return target;
}

describe('SubtopicTableComponent', () => {

  it('enters editing on first focus and shows raw formula', async () => {
    const { fixture } = await setup('=$Amount*$Rate');

    const valueInput = getCellInput(fixture, 'node_1', '$Value');
    expect(valueInput.value).toBe('10');

    focusInput(fixture, valueInput);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(valueInput.value).toBe('=$Amount*$Rate');
  });

  it('inserts a single column reference during formula assist and keeps active edit cell', async () => {
    const { fixture, component } = await setup('=');

    const valueInput = getCellInput(fixture, 'node_1', '$Value');
    focusInput(fixture, valueInput);
    await fixture.whenStable();
    fixture.detectChanges();

    valueInput.setSelectionRange(1, 1);
    const amountInput = getCellInput(fixture, 'node_1', '$Amount');
    amountInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(valueInput.value).toBe('=$Amount');
    expect(valueInput.value.match(/\$Amount/g)?.length ?? 0).toBe(1);
    expect(component.isEditingCell('node_1', '$Value')).toBe(true);
    expect(component.isEditingCell('node_1', '$Amount')).toBe(false);
  });

  it('replaces referenced token at cursor and places caret at inserted token end', async () => {
    const { fixture } = await setup('=$Amount+$Rate');

    const valueInput = getCellInput(fixture, 'node_1', '$Value');
    focusInput(fixture, valueInput);
    await fixture.whenStable();
    fixture.detectChanges();

    valueInput.setSelectionRange(3, 3);
    const rateInput = getCellInput(fixture, 'node_1', '$Rate');
    rateInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    await nextFrame();
    await nextMacrotask();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(valueInput.value).toBe('=$Rate+$Rate');
    expect(valueInput.selectionStart).toBe('=$Rate'.length);
    expect(valueInput.selectionEnd).toBe('=$Rate'.length);
  });

  it('commits once on Enter and exits editing', async () => {
    const { fixture, component, setCellEvents } = await setup('=$Amount*$Rate');

    const amountInput = getCellInput(fixture, 'node_1', '$Amount');
    focusInput(fixture, amountInput);
    await fixture.whenStable();
    fixture.detectChanges();

    amountInput.value = '200';
    amountInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    amountInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(setCellEvents).toHaveLength(1);
    expect(setCellEvents[0]).toEqual({ topicId: 'topic_1', nodeId: 'node_1', columnId: '$Amount', raw: '200' });
    expect(component.isEditingCell('node_1', '$Amount')).toBe(false);
  });

  it('cancels on Escape and blur does not commit', async () => {
    const { fixture, setCellEvents } = await setup('=$Amount*$Rate');

    const amountInput = getCellInput(fixture, 'node_1', '$Amount');
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

  it('shows column ids in headers only during formula editing mode', async () => {
    const { fixture } = await setup('=$Amount*$Rate');

    const headerInputs = () => headerRenameInputs(fixture);

    expect(headerInputs()[0]?.value).toBe('Amount');

    const valueInput = getCellInput(fixture, 'node_1', '$Value');
    focusInput(fixture, valueInput);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(headerInputs()[0]?.value).toBe('$Amount');
  });

  it('focuses header textbox immediately on first click', async () => {
    const { fixture } = await setup();

    const renameInput = headerRenameInputs(fixture)[0];
    expect(renameInput).toBeTruthy();
    renameInput.focus();
    renameInput.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    expect(document.activeElement).toBe(renameInput);
  });

  it('commits header rename on Enter and cancels on Escape', async () => {
    const { fixture, renameColumnEvents } = await setup();

    const renameInput = headerRenameInputs(fixture)[0];
    expect(renameInput).toBeTruthy();
    if (!renameInput) {
      return;
    }
    renameInput.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    renameInput.value = 'Principal';
    renameInput.dispatchEvent(new Event('input', { bubbles: true }));
    renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(renameColumnEvents).toHaveLength(1);
    expect(renameColumnEvents[0]).toEqual({ topicId: 'topic_1', columnId: '$Amount', name: 'Principal' });

    const renameInput2 = headerRenameInputs(fixture)[0];
    expect(renameInput2).toBeTruthy();
    if (!renameInput2) {
      return;
    }
    renameInput2.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    renameInput2.value = 'Ignored';
    renameInput2.dispatchEvent(new Event('input', { bubbles: true }));
    renameInput2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(renameColumnEvents).toHaveLength(1);
  });

  it('clears selection highlight when focus leaves table', async () => {
    const { fixture, selectNodeEvents } = await setup();
    const amountInput = getCellInput(fixture, 'node_1', '$Amount');

    focusInput(fixture, amountInput);
    expect(selectNodeEvents).toContain('node_1');

    amountInput.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
    fixture.detectChanges();

    expect(selectNodeEvents).toContain(null);
  });

  it('shows Add summary cell in context menu and emits sum mode', async () => {
    const { fixture, setColumnSummaryEvents } = await setup('=$Amount*$Rate', false, 'none');
    const amountHeaderInput = headerRenameInputs(fixture)[0];
    if (!amountHeaderInput) {
      throw new Error('Expected amount header input');
    }

    amountHeaderInput.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    fixture.detectChanges();

    const toggleButton = findMenuButtonByText(fixture, 'Add summary cell');
    toggleButton.click();
    fixture.detectChanges();

    expect(setColumnSummaryEvents).toEqual([{ topicId: 'topic_1', columnId: '$Amount', mode: 'sum' }]);
  });

  it('renders summary footer cell with top gap and supports removing summary via summary-cell right click', async () => {
    const { fixture, setColumnSummaryEvents } = await setup('=$Amount*$Rate', true, 'sum');

    const footer = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="summary-footer"]');
    expect(footer).toBeTruthy();

    const summaryCell = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-summary-column-id="$Amount"]');
    expect(summaryCell).toBeTruthy();
    expect(summaryCell?.className).toContain('font-semibold');
    expect(summaryCell?.className).toContain('mt-2');
    expect(summaryCell?.textContent?.trim()).toBe('350');

    summaryCell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 12 }));
    fixture.detectChanges();

    const toggleButton = findMenuButtonByText(fixture, 'Remove summary cell');
    toggleButton.click();
    fixture.detectChanges();

    expect(setColumnSummaryEvents).toContainEqual({ topicId: 'topic_1', columnId: '$Amount', mode: 'none' });
  });

  it('shows N/A when summary column contains at least one invalid text literal', async () => {
    await TestBed.configureTestingModule({
      imports: [SubtopicTableComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(SubtopicTableComponent);
    const topic = buildTopic('=$Amount*$Rate', true, 'sum');
    const secondRow = topic.children[1];
    if (!secondRow) {
      throw new Error('Expected second row');
    }

    secondRow.cells['$Amount'] = { raw: 'text', value: 0, error: null };
    fixture.componentRef.setInput('topic', topic);
    fixture.componentRef.setInput('selectedNodeId', null);
    fixture.detectChanges();

    const summaryCell = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-summary-column-id="$Amount"]');
    expect(summaryCell?.textContent?.trim()).toBe('N/A');
  });

  it('keeps zero-row empty state without rendering headers or summary footer', async () => {
    await TestBed.configureTestingModule({
      imports: [SubtopicTableComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(SubtopicTableComponent);
    const topic = buildTopic();
    topic.children = [];
    fixture.componentRef.setInput('topic', topic);
    fixture.componentRef.setInput('selectedNodeId', null);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('No nodes yet. Add one in the tree graph.');
    expect(root.querySelector('thead')).toBeNull();
    expect(root.querySelector('[data-testid="summary-footer"]')).toBeNull();
  });
});
