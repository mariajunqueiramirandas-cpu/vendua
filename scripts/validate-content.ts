import { project } from '../src/lib/content/project';
import { existsSync } from 'node:fs';
if (!project.name || !project.context || project.views.length !== 2 || !project.capabilities.length)
  throw new Error('Conteúdo obrigatório do projeto ausente.');
for (const view of project.views) {
  if (!view.title || !view.alt || !view.caption || !view.benefits.length)
    throw new Error('Visão do projeto incompleta.');
  for (const path of [view.src, view.original])
    if (!existsSync('static' + path)) throw new Error(`Captura obrigatória ausente: ${path}`);
}
console.log('Conteúdo e capturas do projeto validados.');
