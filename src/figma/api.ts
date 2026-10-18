import { figmaAccessToken } from '../config/env.js';
import { writeFile } from 'node:fs/promises';
import type { ComponentSnapshot, MeasuredValue, ViewportConfig } from '../types/index.js';

export interface ParsedFigmaUrl {
  fileKey: string;
  nodeId: string;
}

export interface FigmaApiNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaApiNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  characters?: string;
  visible?: boolean;
  opacity?: number;
  cornerRadius?: number;
  strokeWeight?: number;
  layoutMode?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  style?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeightPx?: number;
    letterSpacing?: number;
    textAlignHorizontal?: string;
    textCase?: string;
    textDecoration?: string;
  };
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
}

interface FigmaPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number; a?: number };
}

interface FigmaNodesResponse {
  name?: string;
  nodes?: Record<string, { document?: FigmaApiNode } | null>;
  err?: string;
  message?: string;
}

interface FigmaImagesResponse {
  images?: Record<string, string | null>;
  err?: string;
  message?: string;
}

export interface FigmaFrameCandidate {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
}

export function parseFigmaUrl(value: string): ParsedFigmaUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('A URL do Figma é inválida.');
  }
  if (!/(^|\.)figma\.com$/i.test(url.hostname)) {
    throw new Error('A URL informada não pertence ao Figma.');
  }
  const match = url.pathname.match(/^\/(?:design|file|proto)\/([^/]+)/i);
  if (!match?.[1]) {
    throw new Error('Não foi possível identificar a chave do arquivo na URL do Figma.');
  }
  const rawNodeId = url.searchParams.get('node-id');
  if (!rawNodeId) {
    throw new Error('A URL do Figma precisa conter o parâmetro node-id.');
  }
  return { fileKey: match[1], nodeId: rawNodeId.replace(/-/g, ':') };
}

function apiError(status: number, payload: FigmaNodesResponse): Error {
  if (status === 401 || status === 403) {
    return new Error('O Figma recusou o acesso. Confirme se o token é válido, possui file_content:read e se sua conta tem acesso ao arquivo.');
  }
  const detail = payload.err || payload.message;
  return new Error(`A API do Figma retornou HTTP ${status}${detail ? `: ${detail}` : '.'}`);
}

export async function getFigmaNode(
  value: string,
  options: { token?: string; fetchImpl?: typeof fetch } = {}
): Promise<{ fileName: string; node: FigmaApiNode; parsed: ParsedFigmaUrl }> {
  const parsed = parseFigmaUrl(value);
  const token = options.token?.trim() || figmaAccessToken();
  if (!token) {
    throw new Error('Token do Figma não configurado. Preencha FIGMA_ACCESS_TOKEN no arquivo .env local.');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = new URL(`https://api.figma.com/v1/files/${encodeURIComponent(parsed.fileKey)}/nodes`);
  endpoint.searchParams.set('ids', parsed.nodeId);
  const response = await fetchImpl(endpoint, { headers: { 'X-Figma-Token': token } });
  let payload: FigmaNodesResponse = {};
  try {
    payload = await response.json() as FigmaNodesResponse;
  } catch {
    // A mensagem abaixo é deliberadamente genérica para nunca incluir cabeçalhos ou credenciais.
  }
  if (!response.ok) throw apiError(response.status, payload);
  const entry = payload.nodes?.[parsed.nodeId];
  if (!entry?.document) {
    throw new Error(`O nó ${parsed.nodeId} não foi encontrado ou não está acessível nesse arquivo.`);
  }
  return { fileName: payload.name || 'Arquivo do Figma', node: entry.document, parsed };
}

export function findFrameCandidates(root: FigmaApiNode): FigmaFrameCandidate[] {
  const candidates: FigmaFrameCandidate[] = [];
  const visit = (node: FigmaApiNode): void => {
    const box = node.absoluteBoundingBox;
    if (box && ['FRAME', 'COMPONENT', 'INSTANCE'].includes(node.type) && box.width > 0 && box.height > 0) {
      candidates.push({ id: node.id, name: node.name, type: node.type, width: box.width, height: box.height });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return candidates.sort((left, right) => (right.width * right.height) - (left.width * left.height));
}

function words(value: string): string[] {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((word) => word.length > 2);
}

export function selectFrameForViewport(root: FigmaApiNode, viewport: ViewportConfig, hint = ''): FigmaApiNode {
  if (['FRAME', 'COMPONENT', 'INSTANCE'].includes(root.type) && root.absoluteBoundingBox) {
    const widthDifference = Math.abs(root.absoluteBoundingBox.width - viewport.width) / viewport.width;
    if (widthDifference <= 0.25) return root;
    throw new Error(`O link aponta diretamente para um frame de ${Math.round(root.absoluteBoundingBox.width)}px, incompatível com ${viewport.label} (${viewport.width}px). Use a URL da página do Figma que contém todos os frames.`);
  }
  const nodes: FigmaApiNode[] = [];
  const visit = (node: FigmaApiNode): void => {
    const box = node.absoluteBoundingBox;
    if (box && ['FRAME', 'COMPONENT', 'INSTANCE'].includes(node.type) && box.width > 0 && box.height >= viewport.height * 0.8) {
      nodes.push(node);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  if (!nodes.length) throw new Error(`Nenhum frame compatível com ${viewport.label} foi encontrado dentro do nó informado.`);
  const namePattern = viewport.isMobile ? /mobile|mob|iphone|celular/i : /desktop|desk|web/i;
  const hintWords = new Set(words(hint));
  const hintScore = (name: string): number => words(name).filter((word) => hintWords.has(word)).length * 1200;
  return nodes.sort((left, right) => {
    const leftBox = left.absoluteBoundingBox!;
    const rightBox = right.absoluteBoundingBox!;
    const leftScore = Math.abs(leftBox.width - viewport.width) * 20 - Math.min(leftBox.height, 30000) / 100
      - (namePattern.test(left.name) ? 500 : 0) - hintScore(left.name);
    const rightScore = Math.abs(rightBox.width - viewport.width) * 20 - Math.min(rightBox.height, 30000) / 100
      - (namePattern.test(right.name) ? 500 : 0) - hintScore(right.name);
    return leftScore - rightScore;
  })[0]!;
}

function measured(value: string | number): MeasuredValue {
  return { value, certainty: 'MEASURED' };
}

function colorValue(paints: FigmaPaint[] | undefined): string | null {
  const paint = paints?.find((item) => item.type === 'SOLID' && item.visible !== false && item.color);
  if (!paint?.color) return null;
  const alpha = (paint.color.a ?? 1) * (paint.opacity ?? 1);
  return `rgba(${Math.round(paint.color.r * 255)}, ${Math.round(paint.color.g * 255)}, ${Math.round(paint.color.b * 255)}, ${Number(alpha.toFixed(3))})`;
}

export function extractFigmaApiComponents(root: FigmaApiNode): ComponentSnapshot[] {
  const origin = root.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  const components: ComponentSnapshot[] = [];
  const visit = (node: FigmaApiNode): void => {
    const box = node.absoluteBoundingBox;
    const relevant = box && node.visible !== false && ['FRAME', 'COMPONENT', 'INSTANCE', 'TEXT'].includes(node.type);
    if (relevant) {
      const styles: Record<string, MeasuredValue> = {};
      const add = (property: string, value: string | number | undefined | null): void => {
        if (value !== undefined && value !== null && value !== '') styles[property] = measured(value);
      };
      add('font-family', node.style?.fontFamily);
      add('font-size', node.style?.fontSize === undefined ? undefined : `${node.style.fontSize}px`);
      add('font-weight', node.style?.fontWeight);
      add('line-height', node.style?.lineHeightPx === undefined ? undefined : `${node.style.lineHeightPx}px`);
      add('letter-spacing', node.style?.letterSpacing === undefined ? undefined : `${node.style.letterSpacing}px`);
      add('text-align', node.style?.textAlignHorizontal?.toLowerCase());
      add('text-transform', node.style?.textCase?.toLowerCase());
      add('text-decoration-line', node.style?.textDecoration?.toLowerCase());
      add('color', node.type === 'TEXT' ? colorValue(node.fills) : undefined);
      add('background-color', node.type !== 'TEXT' ? colorValue(node.fills) : undefined);
      add('border-color', colorValue(node.strokes));
      add('border-width', node.strokeWeight === undefined ? undefined : `${node.strokeWeight}px`);
      add('border-radius', node.cornerRadius === undefined ? undefined : `${node.cornerRadius}px`);
      add('opacity', node.opacity);
      add('display', node.layoutMode ? 'flex' : undefined);
      add('gap', node.itemSpacing === undefined ? undefined : `${node.itemSpacing}px`);
      add('padding-top', node.paddingTop === undefined ? undefined : `${node.paddingTop}px`);
      add('padding-right', node.paddingRight === undefined ? undefined : `${node.paddingRight}px`);
      add('padding-bottom', node.paddingBottom === undefined ? undefined : `${node.paddingBottom}px`);
      add('padding-left', node.paddingLeft === undefined ? undefined : `${node.paddingLeft}px`);
      components.push({
        id: node.id,
        name: node.name || node.characters?.slice(0, 100) || node.type,
        tag: node.type.toLowerCase(),
        order: components.length,
        text: (node.characters || node.name || '').trim().replace(/\s+/g, ' ').slice(0, 500),
        rect: { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height },
        certainty: 'MEASURED',
        styles,
        children: node.children?.length ?? 0
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return components.slice(0, 1500);
}

export async function downloadFigmaNodeImage(options: {
  fileKey: string;
  nodeId: string;
  output: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const token = options.token?.trim() || figmaAccessToken();
  if (!token) throw new Error('Token do Figma não configurado. Preencha FIGMA_ACCESS_TOKEN no arquivo .env local.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = new URL(`https://api.figma.com/v1/images/${encodeURIComponent(options.fileKey)}`);
  endpoint.searchParams.set('ids', options.nodeId);
  endpoint.searchParams.set('format', 'png');
  endpoint.searchParams.set('scale', '1');
  const response = await fetchImpl(endpoint, { headers: { 'X-Figma-Token': token } });
  let payload: FigmaImagesResponse = {};
  try { payload = await response.json() as FigmaImagesResponse; } catch { /* mensagem segura abaixo */ }
  if (!response.ok) throw apiError(response.status, payload);
  const imageUrl = payload.images?.[options.nodeId];
  if (!imageUrl) throw new Error('O Figma não conseguiu renderizar o frame selecionado.');
  const imageResponse = await fetchImpl(imageUrl);
  if (!imageResponse.ok) throw new Error(`Não foi possível baixar a imagem renderizada pelo Figma (HTTP ${imageResponse.status}).`);
  await writeFile(options.output, Buffer.from(await imageResponse.arrayBuffer()));
}
