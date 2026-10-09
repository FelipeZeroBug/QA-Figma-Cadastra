import path from 'node:path';
import sharp from 'sharp';
import type { ComponentSnapshot, Issue } from '../types/index.js';
import { ensureDir, taskSlug } from '../utils/files.js';

function findComponent(issue: Issue, components: ComponentSnapshot[]): ComponentSnapshot | undefined {
  const needle = issue.component.toLowerCase();
  return components.find((component) => component.name.toLowerCase().includes(needle) || needle.includes(component.name.toLowerCase()));
}

export async function createIssueEvidence(options: {
  issues: Issue[]; components: ComponentSnapshot[]; developmentScreenshot: string; figmaScreenshot: string;
  diffScreenshot: string; issuesDir: string; viewportHeight: number; viewportWidth: number;
}): Promise<void> {
  await ensureDir(options.issuesDir);
  for (let index = 0; index < options.issues.length; index += 1) {
    const issue = options.issues[index]!;
    const component = findComponent(issue, options.components);
    issue.id = `${index + 1}-${taskSlug(issue.component).toLowerCase()}`;
    if (issue.evidence?.figma && issue.evidence?.development) continue;
    issue.evidence = { figma: options.figmaScreenshot, diff: options.diffScreenshot };
    if (!component || component.rect.width < 2 || component.rect.height < 2) continue;
    const padding = 24;
    const left = Math.max(0, Math.floor(component.rect.x) - padding);
    const top = Math.max(0, Math.floor(component.rect.y) - padding);
    const desiredWidth = Math.max(1, Math.floor(component.rect.width) + padding * 2);
    const desiredHeight = Math.max(1, Math.floor(component.rect.height) + padding * 2);
    const sources = [
      ['figma', options.figmaScreenshot],
      ['development', options.developmentScreenshot],
      ['diff', options.diffScreenshot]
    ] as const;
    for (const [kind, source] of sources) {
      const metadata = await sharp(source).metadata().catch(() => null);
      const imageWidth = metadata?.width ?? options.viewportWidth;
      const imageHeight = metadata?.height ?? options.viewportHeight;
      if (left >= imageWidth || top >= imageHeight) continue;
      const width = Math.min(imageWidth - left, desiredWidth);
      const height = Math.min(imageHeight - top, desiredHeight);
      if (width <= 0 || height <= 0) continue;
      const output = path.join(options.issuesDir, `${issue.id}-${kind}.png`);
      const created = await sharp(source).extract({ left, top, width, height }).png().toFile(output)
        .then(() => true).catch(() => false);
      if (created) issue.evidence[kind] = output;
    }
  }
}
