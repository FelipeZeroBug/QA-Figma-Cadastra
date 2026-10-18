import { describe, expect, it, vi } from 'vitest';
import { findFrameCandidates, getFigmaNode, parseFigmaUrl, selectFrameForViewport } from '../src/figma/api.js';

describe('Figma API', () => {
  it('extrai a chave do arquivo e normaliza o node-id', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/abc123/Arquivo?node-id=695-72805')).toEqual({
      fileKey: 'abc123', nodeId: '695:72805'
    });
  });

  it('rejeita URLs externas', () => {
    expect(() => parseFigmaUrl('https://example.com/design/abc?node-id=1-2')).toThrow('não pertence ao Figma');
  });

  it('lista frames disponíveis dentro do nó', () => {
    const root = {
      id: '1:1', name: 'Página', type: 'CANVAS', children: [
        { id: '2:1', name: 'Desktop', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 5000 } },
        { id: '2:2', name: 'Mobile', type: 'FRAME', absoluteBoundingBox: { x: 1500, y: 0, width: 390, height: 6000 } }
      ]
    };
    const frames = findFrameCandidates(root);
    expect(frames.map((frame) => frame.name)).toEqual(['Desktop', 'Mobile']);
    expect(selectFrameForViewport(root, {
      label: 'Mobile', width: 390, height: 844, deviceScaleFactor: 1, isMobile: true
    }).name).toBe('Mobile');
  });

  it('prioriza a LP indicada quando a página contém vários frames', () => {
    const root = {
      id: '1:1', name: 'Página', type: 'CANVAS', children: [
        { id: '2:1', name: 'CNA na Empresa', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 10000 } },
        { id: '2:2', name: 'Seja Franqueado', type: 'FRAME', absoluteBoundingBox: { x: 1500, y: 0, width: 1440, height: 9000 } }
      ]
    };
    expect(selectFrameForViewport(root, {
      label: 'Desktop', width: 1440, height: 900, deviceScaleFactor: 1
    }, '/seja-franqueado').name).toBe('Seja Franqueado');
  });

  it('não vaza o token em uma falha de autenticação', async () => {
    const token = 'segredo-que-nao-pode-aparecer';
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: 'Forbidden' }), {
      status: 403, headers: { 'content-type': 'application/json' }
    }));
    await expect(getFigmaNode('https://www.figma.com/design/abc/Arquivo?node-id=1-2', {
      token, fetchImpl: fetchImpl as typeof fetch
    })).rejects.not.toThrow(token);
  });
});
