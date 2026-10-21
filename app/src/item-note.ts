import { createElement } from 'react';
import Markdown from 'react-markdown';
import { toString } from 'mdast-util-to-string';
import type { Root } from 'mdast';

export function ItemNote({ name, body }: { name: string; body: string }) {
  function hideRepeatedTitle() {
    return (tree: Root) => {
      const first = tree.children[0];
      const normalize = (text: string) => text.trim().replace(/\s+/gu, ' ');
      if (first?.type === 'heading' && normalize(toString(first)) === normalize(name)) {
        tree.children.shift();
      }
    };
  }

  // Transform only the presentation AST; the stored body remains untouched.
  return createElement('div', { className: 'note' },
    createElement(Markdown, { skipHtml: true, remarkPlugins: [hideRepeatedTitle], children: body }));
}
