import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/document/document-page.component').then((m) => m.DocumentPageComponent),
  },
];
