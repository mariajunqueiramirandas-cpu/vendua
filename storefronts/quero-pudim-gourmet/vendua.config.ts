import { defineStorefront } from '@vendua/kernel/config';
import tokens from './tokens.json';

export default defineStorefront({
  contract: 2,
  tokens,
  paths: { catalog: '/cardapio' },
  budgets: 'default',
});
