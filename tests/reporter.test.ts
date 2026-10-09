import { describe, expect, it } from 'vitest';
import { determineStatus } from '../src/reporter/index.js';
import type { Issue, QaConfig } from '../src/types/index.js';

const approval = { failOnCritical: true, failOnHigh: true, failOnMedium: false, failOnLow: false };
const config = { approval } as QaConfig;
const issue = (severity: Issue['severity']): Issue => ({
  component: 'Hero', viewport: 'desktop', category: 'VISUAL', property: 'gap', expected: '16px', actual: '8px',
  difference: '-8px', severity, description: 'Diferença', recommendation: 'Ajustar', confidence: 1, source: 'deterministic'
});

describe('determineStatus', () => {
  it('reprova severidade alta', () => expect(determineStatus([issue('ALTO')], config)).toBe('REPROVADO'));
  it('não reprova severidade baixa por padrão', () => expect(determineStatus([issue('BAIXO')], config)).toBe('APROVADO'));
});
