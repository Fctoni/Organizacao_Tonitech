import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';

const units: Record<string, string> = {
  m: 'mt', mt: 'mt', metro: 'mt', metros: 'mt',
  un: 'un', unidade: 'un', unidades: 'un', peca: 'un', pecas: 'un',
  kg: 'kg', quilo: 'kg', quilos: 'kg', quilograma: 'kg', quilogramas: 'kg',
  l: 'lt', lt: 'lt', litro: 'lt', litros: 'lt',
};

function declarationText(node: Nodes): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'paragraph' || node.type === 'strong' || node.type === 'emphasis') return node.children.map(declarationText).join('');
  return '\0'; // Code, links, images and HTML cannot supply unit metadata.
}

// Presentation only: a whole paragraph/list entry must declare the unit.
// Quotes, code, dimensions, unsupported/conflicting units and truncated notes are not evidence.
export function unitSuffix(item: { body?: string; bodyTruncated?: boolean }): string {
  if (!item.body || item.bodyTruncated) return '';
  const declared: string[] = [];
  function visit(node: Nodes) {
    if (node.type === 'paragraph') {
      const text = declarationText(node).normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase();
      const match = /^unidade(?: de medida)?\s*:\s*([\s\S]*?)\.?$/u.exec(text);
      if (match) declared.push(Object.hasOwn(units, match[1]) ? units[match[1]] : '');
    } else if (node.type === 'root' || node.type === 'list' || node.type === 'listItem') {
      node.children.forEach(visit);
    }
  }
  visit(fromMarkdown(item.body));
  return declared.length && declared[0] && declared.every(unit => unit === declared[0]) ? ` ${declared[0]}` : '';
}
