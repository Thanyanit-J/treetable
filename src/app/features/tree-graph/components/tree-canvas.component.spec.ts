import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CdkDrag } from '@angular/cdk/drag-drop';
import { TreeTopic } from '../models/tree-table.model';
import { TreeCanvasComponent } from './tree-canvas.component';

const TOPIC: TreeTopic = {
  id: 'topic_1',
  label: 'Topic 1',
  columns: [
    { id: '$A', name: 'A', type: 'number' },
    { id: '$B', name: 'B', type: 'number' },
  ],
  children: [
    {
      id: 'subtopic_1',
      topicId: 'topic_1',
      label: 'Subtopic 1',
      cells: {},
    },
  ],
};

function topicInput(fixture: ComponentFixture<TreeCanvasComponent>): HTMLInputElement {
  const input = fixture.nativeElement.querySelector('input[aria-label^="Topic label:"]') as HTMLInputElement | null;
  if (!input) {
    throw new Error('Topic input not found');
  }
  return input;
}

function subtopicInput(fixture: ComponentFixture<TreeCanvasComponent>): HTMLInputElement {
  const input = fixture.nativeElement.querySelector('input[aria-label^="Subtopic label:"]') as HTMLInputElement | null;
  if (!input) {
    throw new Error('Subtopic input not found');
  }
  return input;
}

async function setup(): Promise<{
  fixture: ComponentFixture<TreeCanvasComponent>;
  renameEvents: Array<{ nodeId: string; label: string }>;
  selectEvents: Array<string | null>;
}> {
  await TestBed.configureTestingModule({
    imports: [TreeCanvasComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(TreeCanvasComponent);
  fixture.componentRef.setInput('topic', TOPIC);
  fixture.componentRef.setInput('selectedNodeId', null);

  const renameEvents: Array<{ nodeId: string; label: string }> = [];
  const selectEvents: Array<string | null> = [];
  fixture.componentInstance.renameNode.subscribe((payload) => renameEvents.push(payload));
  fixture.componentInstance.selectNode.subscribe((payload) => selectEvents.push(payload));

  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, renameEvents, selectEvents };
}

describe('TreeCanvasComponent', () => {
  it('commits topic rename on blur', async () => {
    const { fixture, renameEvents } = await setup();
    const input = topicInput(fixture);

    input.dispatchEvent(new FocusEvent('focus'));
    input.value = 'Topic Renamed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();

    expect(renameEvents).toEqual([{ nodeId: 'topic_1', label: 'Topic Renamed' }]);
  });

  it('commits subtopic rename on Enter', async () => {
    const { fixture, renameEvents } = await setup();
    const input = subtopicInput(fixture);

    input.dispatchEvent(new FocusEvent('focus'));
    input.value = 'Subtopic Renamed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(renameEvents).toEqual([{ nodeId: 'subtopic_1', label: 'Subtopic Renamed' }]);
  });

  it('cancels rename on Escape', async () => {
    const { fixture, renameEvents } = await setup();
    const input = topicInput(fixture);

    input.dispatchEvent(new FocusEvent('focus'));
    input.value = 'Should Cancel';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    input.dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();

    expect(renameEvents).toHaveLength(0);
    expect(input.value).toBe('Topic 1');
  });

  it('clears selection when focus leaves the tree canvas', async () => {
    const { fixture, selectEvents } = await setup();
    const input = topicInput(fixture);

    input.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(selectEvents).toContain('topic_1');

    input.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
    fixture.detectChanges();

    expect(selectEvents).toContain(null);
  });

  it('does not render topic drag handle', async () => {
    const { fixture } = await setup();
    const topicDragButton = fixture.nativeElement.querySelector('button[aria-label="Drag topic"]');
    expect(topicDragButton).toBeNull();
  });

  it('applies solid drag preview class to subtopic drag', async () => {
    const { fixture } = await setup();
    const drags = fixture.debugElement.queryAll(By.directive(CdkDrag)).map((item) => item.injector.get(CdkDrag));
    const subtopicDrag = drags.find((drag) => {
      const data = drag.data as { id?: string } | undefined;
      return data?.id === 'subtopic_1';
    });
    expect(subtopicDrag?.previewClass).toBe('drag-preview-solid');
  });

  it('renders only row connector elements for subtopic lines', async () => {
    const { fixture } = await setup();
    const inRowConnectors = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-testid="subtopic-row-connector"]'),
    );

    expect(inRowConnectors.length).toBe(1);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="subtopic-outset-connector"]'),
    ).toBeNull();
  });
});
