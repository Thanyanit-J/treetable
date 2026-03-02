import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/tree-graph/tree-graph-page.component').then(
        (m) => m.TreeGraphPageComponent,
      ),
  },
];
