import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type UserConfig } from 'vite';

// The theme switch (ThemeToggle.svelte) sets <html data-theme="light|dark">; without one the system
// decides. CSS keeps writing plain `@media (prefers-color-scheme: dark)`: each such block is scoped to
// `:root:not([data-theme='light'])` and copied out as `:root[data-theme='dark']` rules, so a choice
// wins over the system both ways. In components the root selector is :global().

// postcss comes with Vite, not as a dependency here: take its types from Vite's config
type PostcssOptions = Exclude<NonNullable<NonNullable<UserConfig['css']>['postcss']>, string>;
type PostcssPlugin = Exclude<
  Extract<NonNullable<PostcssOptions['plugins']>[number], { postcssPlugin: string }>,
  (...args: never[]) => unknown
>;
type Root = Parameters<NonNullable<PostcssPlugin['Once']>>[0];
type Rule = Parameters<Parameters<Root['walkRules']>[0]>[0];

const themeSwitch: PostcssPlugin = {
  postcssPlugin: 'vendua-theme-switch',
  Once(root) {
    const svelte = /\.svelte(\?|$)/.test(root.source?.input.file ?? '');
    const at = (sel: string) => (svelte ? `:global(${sel})` : sel);
    const prefix = (rule: Rule, sel: string) =>
      rule.selectors.map((s) =>
        s.trim() === ':root' ? at(`:root${sel.slice(5)}`) : `${at(sel)} ${s}`,
      );
    root.walkAtRules('media', (media) => {
      if (!/^\(\s*prefers-color-scheme:\s*dark\s*\)$/.test(media.params.trim())) return;
      const forced: Rule[] = [];
      media.each((child) => {
        if (child.type !== 'rule') return;
        const node = child as Rule;
        // component CSS passes through twice (preprocess, then as a CSS module): once is enough
        if (node.selector.includes('data-theme')) return;
        forced.push(node.clone({ selectors: prefix(node, ":root[data-theme='dark']") }));
        node.selectors = prefix(node, ":root:not([data-theme='light'])");
      });
      media.after(forced);
    });
  },
};

export default defineConfig({
  plugins: [sveltekit()],
  css: { postcss: { plugins: [themeSwitch] } },
});
