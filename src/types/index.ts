export type ViewportName = 'desktop' | 'tablet' | 'mobile';
export type Certainty = 'MEASURED' | 'INFERRED' | 'UNAVAILABLE';
export type Severity = 'CRITICO' | 'ALTO' | 'MEDIO' | 'BAIXO';
export type Status = 'APROVADO' | 'REPROVADO' | 'INCONCLUSIVO';

export interface ViewportConfig {
  label: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile?: boolean;
}

export interface QaConfig {
  viewports: Record<ViewportName, ViewportConfig>;
  tolerances: {
    positionPx: number;
    dimensionPx: number;
    spacingPx: number;
    fontSizePx: number;
    colorDistance: number;
    pixelThreshold: number;
    maxPixelDiffRatio: number;
  };
  timeouts: { navigationMs: number; resourceMs: number; stabilizationMs: number; codexMs: number; maxScrollSteps: number };
  reportsDir: string;
  ignoredSelectors: string[];
  approval: Record<'failOnCritical' | 'failOnHigh' | 'failOnMedium' | 'failOnLow', boolean>;
  screenshots: { animations: 'disabled' | 'allow'; caret: 'hide' | 'initial'; fullPage: boolean };
  codex: { enabled: boolean; command: string; model: string | null };
}

export interface QaRequest {
  task: string;
  figmaUrl: string;
  figmaUrls?: Partial<Record<ViewportName, string>>;
  workspaceUrl: string;
  route: string;
  viewports: ViewportName[];
}

export interface MeasuredValue<T = string | number | null> {
  value: T;
  certainty: Certainty;
}

export interface Rectangle { x: number; y: number; width: number; height: number }

export interface ComponentSnapshot {
  id: string;
  name: string;
  tag?: string;
  order: number;
  selector?: string;
  text: string;
  rect: Rectangle;
  certainty: Certainty;
  styles: Record<string, MeasuredValue>;
  children: number;
}

export interface FigmaFrame {
  id: string;
  name: string;
  url: string;
  certainty: Certainty;
}

export interface Issue {
  id?: string;
  component: string;
  viewport: string;
  category: string;
  property: string;
  expected: string;
  actual: string;
  difference: string;
  severity: Severity;
  description: string;
  recommendation: string;
  confidence: number;
  source: 'deterministic' | 'codex';
  evidence?: { figma?: string; development?: string; diff?: string };
}

export interface PixelDiffResult {
  differentPixels: number;
  totalPixels: number;
  ratio: number;
  width: number;
  height: number;
}

export interface ViewportResult {
  viewport: ViewportName;
  dimensions: ViewportConfig;
  figmaComponents: ComponentSnapshot[];
  developmentComponents: ComponentSnapshot[];
  deterministicIssues: Issue[];
  codexIssues: Issue[];
  pixelDiff: PixelDiffResult;
  referenceAvailable: boolean;
  referenceError?: string;
  intelligentAnalysisAvailable: boolean;
  intelligentAnalysisError?: string;
  screenshots: { figma: string; development: string; sideBySide: string; diff: string };
}

export interface QaReport {
  task: string;
  figmaUrl: string;
  figmaUrls?: Partial<Record<ViewportName, string>>;
  developmentUrl: string;
  createdAt: string;
  status: Status;
  selectedFrame?: FigmaFrame;
  results: ViewportResult[];
  issues: Issue[];
  summary: { components: number; critical: number; high: number; medium: number; low: number };
}
