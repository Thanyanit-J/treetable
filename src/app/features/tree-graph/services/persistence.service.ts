import { Injectable } from '@angular/core';
import {
  ImportResult,
  STARTER_STATE,
  TreeTableState,
  TreeTableStateV1,
  cloneState,
} from '../models/tree-table.model';

const STORAGE_KEY = 'treetable.v1.state';

@Injectable({ providedIn: 'root' })
export class PersistenceService {
  load(): TreeTableState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return cloneState(STARTER_STATE);
      }
      const parsed = JSON.parse(raw) as Partial<TreeTableStateV1>;
      if (!this.isStateV1(parsed)) {
        return cloneState(STARTER_STATE);
      }
      return parsed;
    } catch {
      return cloneState(STARTER_STATE);
    }
  }

  save(state: TreeTableState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors for private browsing / quota issues.
    }
  }

  export(state: TreeTableState): string {
    return JSON.stringify(state, null, 2);
  }

  import(json: string): { result: ImportResult; state?: TreeTableState } {
    try {
      const parsed = JSON.parse(json) as Partial<TreeTableStateV1>;
      if (!this.isStateV1(parsed)) {
        return { result: { ok: false, error: 'Invalid tree-table JSON format.' } };
      }
      return {
        result: { ok: true },
        state: parsed,
      };
    } catch {
      return {
        result: { ok: false, error: 'Unable to parse JSON file.' },
      };
    }
  }

  private isStateV1(input: Partial<TreeTableStateV1>): input is TreeTableStateV1 {
    return (
      input.version === 1 &&
      Array.isArray(input.topics) &&
      Array.isArray(input.columns) &&
      'selectedNodeId' in input
    );
  }
}
