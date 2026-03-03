import { CdkDrag } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TreeGraphPageComponent } from './tree-graph-page.component';

describe('TreeGraphPageComponent', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [TreeGraphPageComponent],
    }).compileComponents();
  });

  it('applies solid drag preview class to topic card drag', () => {
    const fixture = TestBed.createComponent(TreeGraphPageComponent);
    fixture.detectChanges();

    const drags = fixture.debugElement.queryAll(By.directive(CdkDrag)).map((item) => item.injector.get(CdkDrag));
    const topicDrag = drags.find((drag) => {
      const data = drag.data as { id?: string } | undefined;
      return typeof data?.id === 'string' && data.id.startsWith('topic_');
    });

    expect(topicDrag?.previewClass).toBe('drag-preview-solid');
  });
});
