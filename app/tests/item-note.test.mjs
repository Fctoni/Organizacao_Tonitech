import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ItemNote } from '../src/item-note.ts';

const render = (body, name = 'Cabo USB') => renderToStaticMarkup(createElement(ItemNote, { name, body }));

test('corpo do Item renderiza Markdown e oculta apenas o título inicial repetido', () => {
  const body = '# Cabo USB\n\n- **Blindado**\n- [Manual](https://example.com/manual)\n\n# Cabo USB';
  const html = render(body);
  assert.match(html, /<ul>\s*<li><strong>Blindado<\/strong><\/li>/);
  assert.match(html, /<a href="https:\/\/example.com\/manual">Manual<\/a>/);
  assert.equal((html.match(/<h1>Cabo USB<\/h1>/g) ?? []).length, 1);
});

test('título inicial aceita CRLF, espaços, Setext e formatação; corpo só título fica vazio', () => {
  for (const body of ['\r\n  # Cabo   USB  ##\r\n', 'Cabo USB\r\n========\r\n', '# **Cabo** USB', '# [Cabo USB](https://example.com)', '']) {
    const props = Object.freeze({ name: ' Cabo USB ', body });
    assert.equal(renderToStaticMarkup(createElement(ItemNote, props)), '<div class="note"></div>');
    assert.equal(props.body, body);
  }
});

test('preserva títulos diferentes, título após parágrafo e títulos dentro de código ou citação', () => {
  assert.match(render('# Especificações\n\n# Cabo USB'), /<h1>Especificações<\/h1>\s*<h1>Cabo USB<\/h1>/);
  assert.match(render('Introdução\n\n# Cabo USB'), /<p>Introdução<\/p>\s*<h1>Cabo USB<\/h1>/);
  assert.match(render('```md\n# Cabo USB\n```'), /<pre><code class="language-md"># Cabo USB\n<\/code><\/pre>/);
  assert.match(render('    # Cabo USB'), /<pre><code># Cabo USB\n<\/code><\/pre>/);
  assert.match(render('> # Cabo USB'), /<blockquote>\s*<h1>Cabo USB<\/h1>/);
  assert.match(render('# cabo USB'), /<h1>cabo USB<\/h1>/);
});

test('HTML bruto e URLs executáveis não viram conteúdo ativo', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<iframe src="https://evil.example"></iframe>\n\n[JS](javascript:alert%281%29) [Encoded](jav&#x61;script:alert%281%29) [VB](vbscript:msgbox%281%29) [Data](data:text/html,evil)\n\n![Image](javascript:alert%281%29)\n\n**Seguro**');
  assert.doesNotMatch(html, /<script|<iframe|onerror|(?:href|src)="(?:javascript|vbscript|data):/i);
  assert.match(html, /<strong>Seguro<\/strong>/);
  for (const label of ['JS', 'Encoded', 'VB', 'Data']) assert.match(html, new RegExp(`<a href="">${label}</a>`));
});
