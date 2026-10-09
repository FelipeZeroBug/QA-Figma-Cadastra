# QA Figma Cadastra

Automação local de QA visual que compara uma página desenvolvida com as prévias completas do Figma, do header ao footer, em Desktop e Mobile.

O projeto captura as páginas inteiras, compara cada seção, calcula divergências visuais e gera um relatório em PDF com as evidências do Figma e do desenvolvimento lado a lado.

## O que a automação valida

- LP completa, incluindo conteúdo abaixo da primeira dobra;
- Desktop, Tablet e Mobile;
- existência, ordem e posição das seções;
- dimensões, espaçamentos, tipografia, cores e imagens;
- pixel diff global e por seção;
- evidências recortadas para cada divergência;
- classificação por severidade;
- relatório final em HTML, JSON e PDF.

## Requisitos

- Node.js 20 ou superior;
- Google Chrome instalado;
- Codex CLI instalado e autenticado quando a análise inteligente estiver habilitada.

## Instalação

```bash
npm install
npx playwright install chromium
```

Se a análise via Codex estiver habilitada em `config/default.json`:

```bash
codex login
```

## Autenticação

As sessões são armazenadas somente na pasta local `.auth/`, que não é enviada ao Git.

Para autenticar no Figma:

```bash
npm run auth:figma
```

Para autenticar em uma página de desenvolvimento protegida:

```bash
npm run auth:ws
```

Se o Figma bloquear a captura invisível com erro 403, a automação repete o acesso automaticamente no Google Chrome visível usando a mesma sessão.

## Executar uma validação

```bash
npm run qa
```

O programa solicitará:

1. nome da tarefa;
2. URL completa da página desenvolvida;
3. viewports que serão validados;
4. URL da prévia completa do Figma para cada viewport selecionado.

Exemplo de entradas:

```text
Nome da tarefa: Seja Franqueado
Página desenvolvida: https://site.example.com/seja-franqueado
Figma Desktop: https://www.figma.com/proto/...node-id=...
Figma Mobile: https://www.figma.com/proto/...node-id=...
```

Use uma prévia que represente a LP inteira. Não é necessário enviar links individuais de cada componente.

## Relatórios

Os resultados são criados em `reports/<nome-da-tarefa>/`:

```text
data.json
index.html
qa-visual-report.pdf
desktop/
mobile/
issues/
```

Os relatórios e screenshots são artefatos locais e estão ignorados pelo Git.

## Outros comandos

```bash
npm run qa:demo
npm run report:pdf -- reports/Tarefa/data.json
npm run typecheck
npm run lint
npm test
```

## Configuração

As dimensões dos viewports, tolerâncias, timeouts, seletores ignorados e regras de aprovação ficam em `config/default.json`.

Por padrão:

- problemas críticos e altos reprovam a validação;
- problemas médios e baixos são documentados, mas não reprovam;
- referências bloqueadas ou inválidas geram status `INCONCLUSIVO`.

## Segurança

Não envie para o repositório:

- `.auth/`;
- `.env`;
- `reports/`;
- `output/` ou `outputs/`;
- cookies, tokens, senhas ou screenshots contendo informações confidenciais.
