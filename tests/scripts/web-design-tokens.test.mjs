import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../apps/web/src/', import.meta.url);
const file = new URL('styles/tokens.css', root);
const tokensCss = () => readFileSync(file, 'utf8');

test('the web entry loads the shared tokens once and uses them for global defaults', () => {
  assert.ok(existsSync(file), 'shared token file must exist');
  const entry = readFileSync(new URL('main.tsx', root), 'utf8');
  assert.match(entry, /import ["']\.\/styles\.css["']/);
  const styles = readFileSync(new URL('styles.css', root), 'utf8');
  assert.equal([...styles.matchAll(/@import "\.\/styles\/tokens\.css";/g)].length, 1);
  const base = styles.match(/:root\s*\{([^}]+)\}/)?.[1] ?? '';
  for (const [property, token] of Object.entries({
    color: 'color-text', background: 'color-page', 'font-family': 'font-family',
    'font-size': 'type-body-size', 'line-height': 'type-body-leading',
  })) {
    assert.ok(base.includes(`${property}: var(--${token});`), property);
  }
});

test('control and typography sizes match the design contract without duplicate declarations', () => {
  const pairs = [...tokensCss().matchAll(/^\s*--([a-z][\w-]+):\s*([^;]+);$/gm)];
  const tokens = new Map(pairs.map(([, key, value]) => [key, value]));
  assert.equal(tokens.size, pairs.length, 'token names must be unique');
  for (const [key, value] of Object.entries({
    'control-height-sm': '2.25rem', 'control-height-md': '2.75rem',
    'control-height-lg': '3.25rem', 'input-min-height': 'var(--control-height-md)',
    'touch-target-min': 'var(--control-height-md)', 'type-body-size': '1rem',
    'type-body-leading': '1.5rem', 'layout-max': '75rem',
  })) {
    assert.equal(tokens.get(key), value, key);
  }
});

test('semantic text, controls, and focus colors meet the proposed contrast thresholds', () => {
  const colors = new Map([...tokensCss().matchAll(/^\s*--color-([\w-]+):\s*#([\da-f]{6});$/gim)]
    .map(([, key, hex]) => [key, hex]));
  const luminance = key => {
    const rgb = colors.get(key);
    assert.ok(rgb, `missing color token ${key}`);
    return [0, 2, 4].map(i => parseInt(rgb.slice(i, i + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  };
  for (const [text, background, minimum] of [
    ['text', 'page', 4.5], ['text-muted', 'surface', 4.5],
    ['on-action', 'action', 4.5], ['on-action', 'action-hover', 4.5], ['on-action', 'action-active', 4.5],
    ['info-text', 'info-surface', 4.5], ['success-text', 'success-surface', 4.5],
    ['warning-text', 'warning-surface', 4.5], ['error-text', 'error-surface', 4.5],
    ['disabled-text', 'disabled-surface', 4.5], ['field-border', 'surface', 3], ['focus', 'surface', 3],
  ]) {
    const [high, low] = [luminance(text), luminance(background)].sort((a, b) => b - a);
    const ratio = (high + 0.05) / (low + 0.05);
    assert.ok(ratio >= minimum, `${text}/${background}: ${ratio.toFixed(2)} < ${minimum}`);
  }
});
