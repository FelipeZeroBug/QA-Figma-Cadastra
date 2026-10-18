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

### Figma pela API (recomendado)

Para ler a estrutura do arquivo, os componentes e seus estilos sem depender do navegador, crie um Personal Access Token no Figma com o escopo `file_content:read`.

1. Abra **Figma → Settings → Security → Personal access tokens**;
2. crie um token com acesso de leitura ao conteúdo dos arquivos;
3. copie `.env.example` para `.env`;
4. cole o token somente no arquivo local:

```dotenv
FIGMA_ACCESS_TOKEN=cole_o_novo_token_aqui
```

Confirme o acesso ao arquivo e ao nó antes de executar o QA:

```bash
npm run figma:check -- "https://www.figma.com/design/CHAVE/Arquivo?node-id=1-2" "nome-ou-rota-da-LP"
```

O comando informa o arquivo, o nó e os frames encontrados, mas nunca imprime o token. O arquivo `.env` e suas variações locais são ignorados pelo Git.

### Sessão do navegador

Para autenticar no Figma:

```bash
npm run auth:figma
```

Para autenticar em uma página de desenvolvimento protegida:

```bash
npm run auth:ws
```

Essa sessão continua disponível para links de protótipo. Para links de design e inspeção de estilos, prefira a API, pois o login automatizado pelo Google pode ser bloqueado com erro 403.

## Executar uma validação

```bash
npm run qa
```

O programa solicitará:

1. nome da tarefa;
2. URL completa da página desenvolvida;
3. viewports que serão validados;
4. uma única URL da página do Figma, quando a API estiver configurada; sem token, uma URL de prévia para cada viewport.

Exemplo de entradas:

```text
Nome da tarefa: Seja Franqueado
Página desenvolvida: https://site.example.com/seja-franqueado
Figma Desktop: https://www.figma.com/proto/...node-id=...
Figma Mobile: https://www.figma.com/proto/...node-id=...
```

Com a API configurada, use o link da página que contém os frames completos. A automação escolhe o frame mais compatível com cada viewport e lê suas medidas, textos, cores, tipografia e espaçamentos. Não é necessário enviar links individuais de cada componente.

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
