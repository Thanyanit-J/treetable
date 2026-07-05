/**
 * Real-time completion for formula editors: function names, Reference Names
 * (columns, nodes, topics) and `.sum()`-style aggregates after a column.
 * Pure — the FormulaSuggestService feeds it the Document and the dotted
 * token at the caret.
 */
import {
  AGGREGATE_FUNCTIONS,
  COUNT_FUNCTIONS,
  SCALAR_FUNCTIONS,
} from '../../core/engine/formula-ast';
import {
  DocumentV2,
  NodeV2,
  TopicCardV2,
  isTopicCard,
  walkNodes,
} from '../../core/model/document.model';

export interface FormulaSuggestion {
  /** Text shown in the list. */
  label: string;
  /** Dimmed kind hint next to the label. */
  detail: string;
  /** Replaces the token's last segment. */
  insert: string;
  /** Caret offset from the end of `insert` after accepting (-1 lands in `()`). */
  caretShift: number;
}

const TOKEN_CHAR = /[\w$.]/;
const DOT_METHODS = [...AGGREGATE_FUNCTIONS, ...COUNT_FUNCTIONS].map((name) => name.toLowerCase());
// The overlay scrolls (max-h with overflow), so the cap only guards absurdity.
const MAX_SUGGESTIONS = 40;

/** The dotted token ending at `caret`, or null when the value is no formula. */
export function formulaTokenAt(
  value: string,
  caret: number,
): { token: string; start: number } | null {
  if (!value.trimStart().startsWith('=')) {
    return null;
  }
  const position = Math.max(0, Math.min(caret, value.length));
  let start = position;
  while (start > 0 && TOKEN_CHAR.test(value[start - 1]!)) {
    start -= 1;
  }
  return { token: value.slice(start, position), start };
}

export function suggestForToken(
  document: DocumentV2,
  topicId: string,
  token: string,
): FormulaSuggestion[] {
  const topic = document.cards.find(
    (card): card is TopicCardV2 => isTopicCard(card) && card.id === topicId,
  );
  if (!topic) {
    return [];
  }

  const segments = token.split('.');
  const last = segments.pop() ?? '';
  if (segments.some((segment) => segment.length === 0)) {
    return []; // `..` or a leading dot — nothing sensible to offer.
  }

  const candidates =
    segments.length === 0
      ? rootCandidates(document, topic)
      : scopedCandidates(document, topic, segments);

  const prefix = last.toLowerCase();
  const matches = candidates
    .filter((candidate) => candidate.insert.toLowerCase().startsWith(prefix))
    .slice(0, MAX_SUGGESTIONS);
  if (matches.length === 1 && matches[0]!.insert === last) {
    return []; // Already typed in full.
  }
  return matches;
}

/** Unqualified position: functions first, then columns, nodes, other topics. */
function rootCandidates(document: DocumentV2, topic: TopicCardV2): FormulaSuggestion[] {
  const out: FormulaSuggestion[] = [];
  for (const name of [...AGGREGATE_FUNCTIONS, ...COUNT_FUNCTIONS, ...SCALAR_FUNCTIONS.keys()]) {
    out.push({ label: `${name}(…)`, detail: 'function', insert: `${name}()`, caretShift: -1 });
  }
  for (const column of topic.columns) {
    if (column.kind !== 'chart') {
      out.push({
        label: column.refName,
        detail: column.displayName,
        insert: column.refName,
        caretShift: 0,
      });
    }
  }
  walkNodes(topic.children, (node) => {
    out.push({
      label: node.refName,
      detail: `node · ${node.displayName}`,
      insert: node.refName,
      caretShift: 0,
    });
  });
  for (const card of document.cards) {
    if (isTopicCard(card) && card.id !== topic.id) {
      out.push({
        label: card.refName,
        detail: `topic · ${card.displayName}`,
        insert: card.refName,
        caretShift: 0,
      });
    }
  }
  return out;
}

/**
 * After `Qualifier.`: a topic opens its nodes and columns, a node its
 * descendants and the topic's columns, a column its `.sum()` aggregates.
 */
function scopedCandidates(
  document: DocumentV2,
  currentTopic: TopicCardV2,
  qualifiers: string[],
): FormulaSuggestion[] {
  let topic = currentTopic;
  let scopeNode: NodeV2 | null = null;

  for (const [index, qualifier] of qualifiers.entries()) {
    if (index === 0) {
      const qualifiedTopic = document.cards.find(
        (card): card is TopicCardV2 => isTopicCard(card) && card.refName === qualifier,
      );
      if (qualifiedTopic) {
        topic = qualifiedTopic;
        continue;
      }
    }
    const node = findNodeByRefName(scopeNode ? scopeNode.children : topic.children, qualifier);
    if (node) {
      scopeNode = node;
      continue;
    }
    if (
      index === qualifiers.length - 1 &&
      topic.columns.some((column) => column.refName === qualifier && column.kind !== 'chart')
    ) {
      return DOT_METHODS.map((name) => ({
        label: `.${name}()`,
        detail: 'summary',
        insert: `${name}()`,
        caretShift: 0,
      }));
    }
    return [];
  }

  const out: FormulaSuggestion[] = [];
  for (const column of topic.columns) {
    if (column.kind !== 'chart') {
      out.push({
        label: column.refName,
        detail: column.displayName,
        insert: column.refName,
        caretShift: 0,
      });
    }
  }
  walkNodes(scopeNode ? scopeNode.children : topic.children, (node) => {
    out.push({
      label: node.refName,
      detail: `node · ${node.displayName}`,
      insert: node.refName,
      caretShift: 0,
    });
  });
  return out;
}

function findNodeByRefName(nodes: readonly NodeV2[], refName: string): NodeV2 | null {
  let found: NodeV2 | null = null;
  walkNodes(nodes, (node) => {
    if (node.refName === refName) {
      found = node;
    }
  });
  return found;
}
