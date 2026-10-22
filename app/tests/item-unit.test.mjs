import test from 'node:test';
import assert from 'node:assert/strict';
import { unitSuffix } from '../src/item-unit.ts';

test('unidade explícita em Markdown acompanha quantidade sem converter seu valor', () => {
  for (const body of ['Unidade: metros.', '- **Unidade:** metros', '**Unidade**: **METROS**', 'Unidade de medida: mt']) {
    assert.equal(`2${unitSuffix({ body })}`, '2 mt');
  }
});

test('acentos Unicode, singular/plural e abreviações têm duas letras', () => {
  for (const [value, suffix] of [['peças', 'un'], ['PEC\u0327AS', 'un'], ['unidade', 'un'], ['unidades', 'un'], ['un', 'un'], ['m', 'mt'], ['quilogramas', 'kg'], ['kg', 'kg'], ['litros', 'lt'], ['l', 'lt']]) {
    assert.equal(unitSuffix({ body: `\r\n- **UNIDADE:** ${value}.\r\n` }), ` ${suffix}`);
  }
});

test('não inventa unidade a partir de dimensões, exemplos, declarações ambíguas ou dados incompletos', () => {
  for (const body of ['', 'Cabo USB 2 metros', 'Comprimento: 2 metros', 'Unidade: metros por peça', 'Unidade: pacotes.', 'Unidade: metros\nou peças', 'Unidade: metros. Use peças.', 'Unidade: metros\n\nUnidade: peças', 'Unidade: metros\n\nUnidade: pacotes', '```md\nUnidade: metros\n```', '`Unidade: metros`', '    Unidade: metros', '> Unidade: metros', '# Unidade: metros', 'Exemplo: Unidade: metros', 'Unidade: constructor']) {
    assert.equal(unitSuffix({ body }), '', body);
  }
  assert.equal(unitSuffix({}), '');
  assert.equal(unitSuffix({ body: 'Unidade: metros', bodyTruncated: true }), '');
  assert.equal(unitSuffix({ body: 'Unidade: metros\n\nUnidade: m' }), ' mt');
});
