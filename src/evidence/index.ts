import path from 'node:path';
import sharp from 'sharp';
import type { ComponentSnapshot, Issue } from '../types/index.js';
import { ensureDir, taskSlug } from '../utils/files.js';

function findComponent(issue: Issue, components: ComponentSnapshot[]): ComponentSnapshot | undefined {
  const normalize = (value: string): string => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const needle = normalize(issue.component);
  if (!needle) return undefined;
  return components
    .map((component) => {
      const name = normalize(component.name);
      const text = normalize(component.text);
      const exact = name === needle || text === needle;
      const comparable = (left: string, right: string): boolean =>
        Math.min(left.length, right.length) >= 8 && (left.includes(right) || right.includes(left));
      const includes = comparable(name, needle) || comparable(text, needle);
      return { component, score: exact ? 2 : includes ? 1 : 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score
      || (left.component.rect.width * left.component.rect.height) - (right.component.rect.width * right.component.rect.height))[0]?.component;
}

export async function createIssueEvidence(options: {
  issues: Issue[]; components: ComponentSnapshot[]; figmaComponents: ComponentSnapshot[]; developmentScreenshot: string; figmaScreenshot: string;
  diffScreenshot: string; issuesDir: string; viewportHeight: number; viewportWidth: number;
}): Promise<void> {
  await ensureDir(options.issuesDir);
  for (let index = 0; index < options.issues.length; index += 1) {
    const issue = options.issues[index]!;
    const developmentComponent = findComponent(issue, options.components);
    const figmaComponent = findComponent(issue, options.figmaComponents);
    issue.id = `${index + 1}-${taskSlug(issue.component).toLowerCase()}`;
    if (issue.evidence?.figma && issue.evidence?.development) continue;
    issue.evidence = { figma: options.figmaScreenshot, diff: options.diffScreenshot };
    const padding = 24;
    const sources = [
      ['figma', options.figmaScreenshot, figmaComponent],
      ['development', options.developmentScreenshot, developmentComponent],
      ['diff', options.diffScreenshot, developmentComponent]
    ] as const;
    for (const [kind, source, component] of sources) {
      if (!component || component.rect.width < 2 || component.rect.height < 2) continue;
      const metadata = await sharp(source).metadata().catch(() => null);
      const imageWidth = metadata?.width ?? options.viewportWidth;
      const imageHeight = metadata?.height ?? options.viewportHeight;
      const left = Math.max(0, Math.floor(component.rect.x) - padding);
      const top = Math.max(0, Math.floor(component.rect.y) - padding);
      const desiredWidth = Math.max(1, Math.floor(component.rect.width) + padding * 2);
      const desiredHeight = Math.max(1, Math.floor(component.rect.height) + padding * 2);
      if (left >= imageWidth || top >= imageHeight) continue;
      const width = Math.min(imageWidth - left, desiredWidth);
      const height = Math.min(imageHeight - top, desiredHeight);
      if (width <= 0 || height <= 0) continue;
      const output = path.join(options.issuesDir, `${issue.id}-${kind}.png`);
      const created = await sharp(source).extract({ left, top, width, height })
        .resize({ width: Math.min(width, 1000), withoutEnlargement: true })
        .png({ compressionLevel: 9 }).toFile(output)
        .then(() => true).catch(() => false);
      if (created) issue.evidence[kind] = output;
    }
  }
}
