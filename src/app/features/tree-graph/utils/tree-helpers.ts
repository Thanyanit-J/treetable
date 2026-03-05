import { CellData, TreeNode } from '../models/tree-table.model';

export function collectLeaves(nodes: TreeNode[]): TreeNode[] {
  const leaves: TreeNode[] = [];

  const visit = (node: TreeNode): void => {
    if (node.children.length === 0) {
      leaves.push(node);
      return;
    }

    for (const child of node.children) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return leaves;
}

export function computeLeafCounts(nodes: TreeNode[]): Map<string, number> {
  const counts = new Map<string, number>();

  const visit = (node: TreeNode): number => {
    if (node.children.length === 0) {
      counts.set(node.id, 1);
      return 1;
    }

    let total = 0;
    for (const child of node.children) {
      total += visit(child);
    }
    const normalized = Math.max(1, total);
    counts.set(node.id, normalized);
    return normalized;
  };

  for (const node of nodes) {
    visit(node);
  }

  return counts;
}

export function findNodeAndParent(
  nodes: TreeNode[],
  nodeId: string,
): { node: TreeNode; parent: TreeNode | null; index: number } | null {
  const visit = (entries: TreeNode[], parent: TreeNode | null): { node: TreeNode; parent: TreeNode | null; index: number } | null => {
    for (let index = 0; index < entries.length; index += 1) {
      const node = entries[index];
      if (node.id === nodeId) {
        return { node, parent, index };
      }

      const found = visit(node.children, node);
      if (found) {
        return found;
      }
    }
    return null;
  };

  return visit(nodes, null);
}

export function updateLeafCells(
  nodes: TreeNode[],
  evaluatedCellsById: ReadonlyMap<string, Record<string, CellData>>,
): void {
  const visit = (node: TreeNode): void => {
    if (node.children.length === 0) {
      const evaluated = evaluatedCellsById.get(node.id);
      if (evaluated) {
        node.cells = evaluated;
      }
      return;
    }

    for (const child of node.children) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }
}

export function walkNodes(nodes: TreeNode[], visitor: (node: TreeNode) => void): void {
  const visit = (node: TreeNode): void => {
    visitor(node);
    for (const child of node.children) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }
}

export function nodeExists(nodes: TreeNode[], nodeId: string): boolean {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return true;
    }
    if (nodeExists(node.children, nodeId)) {
      return true;
    }
  }
  return false;
}
