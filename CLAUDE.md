# Tabela de Preços Marfim — Guia para IAs

## Visão geral

Aplicação Google Apps Script (GAS) com dois arquivos:
- `Codigo.gs` — backend (funções GAS chamadas pelo frontend via `google.script.run`)
- `Index.html` — frontend SPA (HTML/CSS/JS inline)

Dados persistidos em Google Sheets. Cada cliente tem uma aba própria com sufixo ` CLIENTE`.

---

## Fluxo de calibração: tabelas de preço reais como fonte de verdade

O usuário mantém na raiz do repositório exports CSV das tabelas de preço reais de cada cliente (ex.: `tabela de preços - DASS CLIENTE.csv`, `tabela de preços - DILLY CLIENTE.csv`, `tabela de preços - RAMARIM CLIENTE.csv`). Esses arquivos são a fonte de verdade do cadastro real — use-os (em vez de supor o formato) sempre que for investigar um problema de conferência de PDF (aba "Conferir").

Fluxo esperado quando o usuário reporta uma divergência/erro de classificação:
1. O usuário sobe o(s) PDF(s) de pedido e/ou print do resultado, e o CSV da tabela do cliente envolvido (via upload no repositório GitHub, não necessariamente neste workspace — pode ser preciso `git fetch`/`git show origin/main:<arquivo>` para acessar).
2. Localizar o item real no CSV (`grep`) para entender exatamente como a referência/descrição/MedidaBase foi cadastrada — **não adivinhar o formato**, casos legados costumam ter inconsistências (ex.: espessura embutida no texto da Referencia em algumas linhas e só na coluna MedidaBase em outras).
3. Identificar a causa raiz no código de parsing/match (`Index.html`, funções `conf*`) reproduzindo o cenário (ideal: script Node isolando as funções puras, sem depender do Apps Script/DOM, para simular `confValidar` contra os dados reais).
4. Ajustar a lógica de interpretação/match para cobrir o caso — preferindo regras determinísticas mais abrangentes (mais sinônimos, mais robustez a variação de formato) a heurísticas vagas, já que a conferência exige bater preço exato em centavos (ver regra de comparação de preço abaixo).
5. Validar com o caso reportado e com casos vizinhos (mesma família de referência, outras combinações de atributo) para não regredir nada.

Esses CSVs **não substituem** a leitura ao vivo da planilha pelo `Codigo.gs` em produção — são apenas snapshots usados para depuração e calibração do parser.

---

## Regra crítica: mudanças no schema da planilha

**Toda vez que adicionar, renomear ou remover uma coluna nas abas de cliente, você DEVE:**

1. Atualizar o array `SCHEMA_CLIENTE` em `Codigo.gs` (próximo ao topo do arquivo):

```javascript
const SCHEMA_CLIENTE = [
  { nome: "Referencia",  largura: 160 },
  { nome: "Descricao",   largura: 220 },
  { nome: "Preco",       largura: 120 },
  { nome: "DataInicio",  largura: 120 },
  { nome: "DataFim",     largura: 120 },
  { nome: "Observacoes", largura: 200 },
  { nome: "Unidade",     largura: 100 },
  { nome: "MedidaBase",  largura: 100 },
  { nome: "PrecoRS",     largura: 100 },
  { nome: "PrecoBA",     largura: 100 },
  { nome: "PrecoCE",     largura: 100 },
  { nome: "PrecoMG",     largura: 100 },
  { nome: "Peso",        largura: 100 },
  { nome: "PrecoAtivo",  largura: 100 },
  { nome: "PrecoBase",   largura: 100 },
  // → adicione novas colunas SEMPRE ao final
];
```

2. **Nunca reordenar** entradas existentes — a ordem define a posição das colunas na planilha.

3. Novas colunas vão **sempre ao final** do array.

4. Atualizar o comentário no topo do arquivo que documenta o layout das colunas.

5. Informar ao usuário que ele precisa rodar `setup()` ou `migrarSchema()` no Apps Script para aplicar as colunas nas planilhas existentes.

### Como aplicar o schema nas planilhas existentes

O usuário deve abrir o Apps Script e executar uma destas funções:

- **`setup()`** — faz tudo: cria abas necessárias + aplica migração de schema
- **`migrarSchema()`** — apenas aplica colunas faltantes em abas de cliente existentes (mais seguro, sem recriar nada)

Ambas são **idempotentes** — podem ser executadas múltiplas vezes sem risco de perda de dados.

---

## Schema atual das abas de cliente

| Coluna | Nome         | Tipo    | Obrigatório |
|--------|--------------|---------|-------------|
| A      | Referencia   | String  | Sim         |
| B      | Descricao    | String  | Não         |
| C      | Preco        | Number  | Sim         |
| D      | DataInicio   | Date    | Sim         |
| E      | DataFim      | Date    | Não         |
| F      | Observacoes  | String  | Não         |
| G      | Unidade      | String  | Sim (`metros` / `pares` / `pecas` / `kg`) |
| H      | MedidaBase   | Number  | Sim para metros (mm) e pares/peças (cm); **não se aplica a `kg`** |
| I      | PrecoRS      | Number  | Não (usa Preco base se vazio/zero) |
| J      | PrecoBA      | Number  | Não (usa Preco base se vazio/zero) |
| K      | PrecoCE      | Number  | Não (usa Preco base se vazio/zero) |
| L      | PrecoMG      | Number  | Não (usa Preco base se vazio/zero) |
| M      | Peso         | Number  | Não (peso do material, ex: g/m) |
| N      | PrecoAtivo   | Number  | Não (`1` = preço ativado manualmente por admin; vazio = normal) |
| O      | PrecoBase    | Number  | Não (preço base **informativo** dos clientes "preço duplo", ex. DAKOTA — visível só na aba Cadastrar; não entra em consulta, impressão nem emails) |

Itens sem Unidade/MedidaBase (legados) são tratados como `metros` com cálculo direto `preco × entrada`.
Preços por estado são opcionais; quando zero/ausentes, o frontend usa o Preco base.

**Atenção (colunas legadas N/O/P):** as abas antigas importadas trazem cabeçalhos legados `Custo/RS` (N), `Custo/BA/CE` (O) e `nov./22` (P) — e, em DASS/RAMARIM, ainda há **dados** de custo nessas colunas. `migrarSchema()` não sobrescreve cabeçalho ocupado, mas o código lê/escreve **por posição**: N é tratada como `PrecoAtivo` e O como `PrecoBase` independentemente do texto do cabeçalho. O frontend preserva o valor existente de O ao editar uma linha (round-trip via `precoBase`), mas o ideal é mover os custos legados para colunas além do schema (ex.: AA em diante) e renomear N1/O1 para os nomes do schema.

### Clientes "preço duplo" (origem/destino) — ex.: DAKOTA

Configurados na lista `CLIENTES_PRECO_DUPLO` em `Codigo.gs` (nome do cliente sem o sufixo ` CLIENTE`; helper `_ehPrecoDuplo(nomeAba)`; o frontend recebe o flag em `getReferencias().precoDuplo` e o guarda em `S.consPrecoDuplo`/`S.cadPrecoDuplo`). Nesses clientes:

- **As colunas de preço por estado mudam de papel** (mesma ordem dos cabeçalhos renomeados na planilha do cliente): **I (PrecoRS) = RS/CE**, **J (PrecoBA) = RS/RS**, **K (PrecoCE) = CE/CE**; **L (PrecoMG) não é usada** (campo oculto na interface). Os rótulos vêm de `rotulosPreco(duplo)` no `Index.html` (rótulo `null` = coluna oculta) e valem para consulta, calculadora, histórico, impressão e emails.
- **Preço base (coluna O, PrecoBase)**: informado no formulário do Cadastrar (campo "BASE (R$)", com dica) e no modal Atualizar Preço; é **apenas informativo** — fica salvo no item e aparece só na lista/histórico da aba Cadastrar (badge "💰 Base"), nunca na consulta, impressão ou emails. `renovarReferencia` **não** copia o PrecoBase da vigência antiga (usa o digitado no modal, ou vazio).
- **Variações % sobre o preço base** ficam nas células **W1 (RS/CE), X1 (RS/RS), Y1 (CE/CE)** — T1/U1/V1 **não** são usadas nesses clientes. Mesma semântica das T1/U1/V1 (número puro, zero/vazio = sem auto-preenchimento; `preco = base × (1 + var/100)`). Salvas por `salvarDescontosEstado` (que detecta o modo e grava W1:Y1 recebendo `{rsce, rsrs, cece}`); retornadas por `getReferencias` como `descontoRSCE`/`descontoRSRS`/`descontoCECE`. No frontend, `autoFillDuplo` aplica as variações ao digitar o preço base (os três mesmos inputs de variação da aba Cadastrar são reutilizados com rótulos trocados; `autoFillEstados` vira no-op no modo duplo).
- **Regra de "preço atual" por descrição**: a variante passa a ser `Referencia + MedidaBase + Descricao` (`refVarianteKey(x, duplo)` no `Index.html`). A mesma referência com **descrições diferentes** são itens distintos — **todos ficam ativos** (cada um com seu próprio preço atual); com a **mesma descrição** vale a regra normal (só a linha vigente de DataInicio mais recente). O botão "📌 Ativar preco"/ativação manual continua funcionando normalmente.
- **Conflito de vigência no cadastro**: `salvarReferencia` só considera conflito quando `Referencia + MedidaBase + Descricao` coincidem (descrição comparada com trim+uppercase) — cadastrar a mesma referência com descrição diferente salva direto, sem modal, e as duas linhas coexistem ativas.
- A conferência de PDF (aba "Conferir") **não** tem formato DAKOTA calibrado ainda — nada foi alterado nesse fluxo.

### Regra de "Preço atual" e ativação manual (coluna PrecoAtivo)

O "Preço atual" de cada variante (Referencia + MedidaBase) é decidido automaticamente: linha **vigente** com a **DataInicio mais recente** (`calcAtualPorRef` no `Index.html`). Além dele, linhas com `PrecoAtivo = 1` **e ainda vigentes** também são tratadas como ativas (`refEhAtual`): recebem o badge "📌 Preco ativado", a calculadora e aparecem como ativas na impressão.

A ativação manual existe para as tabelas legadas em que a mesma referência agrupa itens distintos que só a descrição separa (ex.: `M15055` "48f. Pol cores diversas" × "48fu.pol. Preto/branco") — a regra automática marca só um deles como atual e o admin força o outro a permanecer ativo.

- Botão "📌 Ativar preco" / "Desativar preco" nos cards das listas (consulta e Cadastrar), visível **apenas para admins** (coluna D = `*`); backend `setPrecoAtivo(nomeAba, linha, ativo, token)` valida admin via `_ehAdmin` e grava `1`/vazio na coluna N.
- `salvarReferencia` preserva a marcação ao editar a linha; `renovarReferencia` **não** herda a marcação para a nova vigência (ela já vira o preço atual automático).
- Marcação em linha fora de vigência é ignorada pelo frontend (linha vencida nunca fica ativa).

### Conflito de vigência no cadastro (modal "Referencia ja cadastrada")

O bloqueio de cadastro repetido não é mais um erro seco. `salvarReferencia(nomeAba, dados, token, linhaEdicao, modoConflito)` detecta sobreposição de vigência **por variante** (mesma `Referencia` **e** mesma `MedidaBase`, comparadas via `pN` — mesmo critério de `refVarianteKey`/`confEscolherVigencia`; medidas diferentes são variantes de tamanho legítimas e coexistem sem aviso) e responde conforme `modoConflito`:

- **vazio/null** — não grava nada; retorna `{ ok:false, conflito:true, conflitos:[{linha, ref, descricao, obs, dataInicio, dataFim}] }`. O frontend (`cadSalvarReferencia`) abre o modal `#modal-conflito` listando as linhas conflitantes com três saídas: Atualizar preço, Cadastrar item repetido, Cancelar.
- **`"atualizar"`** — atualização de preço pelo formulário: encerra a vigência das linhas conflitantes (`DataFim = nova DataInicio − 1 dia`, como `renovarReferencia`) e cadastra a linha nova, que vira o preço atual automático. Só para cadastro novo (erro na edição); também dá erro se alguma linha conflitante tiver `DataInicio` igual/posterior à nova (o encerramento geraria vigência invertida).
- **`"duplicar"`** — cadastro repetido deliberado (**admin apenas**, caso "mesmo item, observações/descrição diferentes"): grava a linha nova **já com `PrecoAtivo = 1`** e marca `PrecoAtivo = 1` também nas linhas conflitantes — os dois preços permanecem ativos (badge "📌 Preco ativado") mesmo com a data nova, via o mecanismo de ativação manual acima. Na **edição** de uma linha repetida existente (o conflito com a linha irmã dispararia o bloqueio e tornaria duplicados ineditáveis), `"duplicar"` apenas libera o salvamento, preservando as marcações de cada linha como estão.

Log de auditoria: `CADASTRAR_DUPLICADO` e `ATUALIZAR_PRECO`, além dos já existentes `CADASTRAR`/`EDITAR`.

### Correção automática de largura no cadastro (pares/peças)

Para evitar famílias de variantes indistinguíveis (caso real `M21020` da RAMARIM: 6mm e 8mm só na descrição), `salvarRef` no frontend corrige o cadastro de itens `pares`/`pecas` cuja referência **não** termina com sufixo de largura (`extrairVarianteMm`): se a Descrição ou Observações mencionam a largura, ela é anexada à referência (ex.: ref `M21020` + desc `...6mm...` → salva como `M21020 6MM`) e o usuário é avisado no toast. Regras do extrator (`cadExtrairMmTexto`, calibrado com as tabelas reais):

- Ignora menções de **fio refletivo** (`reflet.0,5mm`, `refl.0,5mm`, `refletivo 0,5mm`) — componente do cadarço, não a largura dele.
- Só aceita valor **inteiro** (todas as referências reais com sufixo usam inteiro, e a vírgula de um decimal quebraria o `confRefRegex` da conferência de PDF); decimais reais como `2,5mm` (elásticos) permanecem só na descrição.
- Exige exatamente **um** valor distinto no texto — dois valores diferentes = ambíguo, não corrige (cai no aviso já existente de variantes irmãs com mm).
- Se o usuário não informar a largura em lugar nenhum, nada é feito (permanece só o aviso antigo de variantes irmãs, quando aplicável).

### Células T1/U1/V1 — Variação de preço por estado (metadado, fora do SCHEMA_CLIENTE)

As células **T1** (BA), **U1** (CE) e **V1** (MG) de cada aba de cliente armazenam a variação percentual de preço em relação ao RS. Não fazem parte do `SCHEMA_CLIENTE` e não são afetadas por `migrarSchema()`.

- Armazenadas como número puro (ex: `-3` para −3%, `5` para +5%). Célula vazia = sem auto-preenchimento para aquele estado.
- Zero e célula vazia são equivalentes (sentinel value).
- Fórmula: `precoEstado = precoRS × (1 + variação/100)`. Negativo = desconto; positivo = acréscimo.
- Lidas em batch por `getReferencias` via `getRange("T1:V1").getValues()` + `pN()`; retornadas como `descontoBA`, `descontoCE`, `descontoMG`.
- Escritas em batch por `salvarDescontosEstado` via `getRange("T1:V1").setValues(...)`.
- Visíveis na aba "Cadastrar" (admin), linha "Variação por estado (% sobre RS): BA/CE/MG [Salvar variações]".
- `autoFillEstados(rsId, baId, ceId, mgId)` no frontend aplica os valores ao digitar no campo RS; limpa os campos dos estados quando RS é apagado.
- **Clientes "preço duplo"** (ex. DAKOTA) não usam T1/U1/V1: as variações deles ficam em **W1/X1/Y1** e são % sobre o **preço base** (ver seção "Clientes 'preço duplo'" acima). `getReferencias` lê o intervalo `T1:Y1` em um único batch.

### Célula S1 — Prazo de pagamento (metadado, fora do SCHEMA_CLIENTE)

A célula **S1** de cada aba de cliente armazena o prazo de pagamento no formato `"<N> dias"` (ex: `"90 dias"`) ou, para pagamento em parcelas, `"<N1>/<N2> dias"` (ex: `"60/90 dias"`, caso DILLY). Não faz parte do `SCHEMA_CLIENTE` (que cobre apenas A-O) e não é afetada por `migrarSchema()`.

- Definida ao criar um cliente novo (`criarCliente`, campo "Prazo de pagamento" no formulário "Novo Cliente"). O campo aceita um número único (`90`) ou parcelado (`60/90`).
- Editável para clientes existentes na aba "Cadastrar" (campo "Prazo de pagamento" acima do formulário de referência → `salvarPrazoPagamento`), mesmo formato livre (`90` ou `60/90`).
- `getReferencias` retorna `prazoPagamento` (string bruta da célula), `prazoPagamentoDias` (primeiro número, via regex `/\d+/g`, robusto a variações como `"90"`, `"90 dias"`, `"90DIAS"`) e `prazoPagamentoDiasTodos` (array com **todos** os números da célula, ex: `[60, 90]` — usado na comparação multi-parcela).
- Na aba "Conferir", `confParseCampos` extrai o prazo do PDF:
  - DASS/RAMARIM: `Condições de pagto: 90DIAS` → regex `/Condi\S*\s+de\s+pag\S*\s*:?\s*(\d+)\s*dias/i` → um único número.
  - DILLY: tabela "Previsão" com colunas "Dias Parcela" / "Valor Parcela" na última página de cada OC — pagamento sempre em 2 parcelas iguais (50%/50% do total), tipicamente 60 e 90 dias. `confParseCampos` localiza a linha `Dias Parcela`, lê cada linha seguinte que casa `^(\d{2,3})\s*R\$` até a linha `Total`, e monta `prazoPagamento` como `"60/90"` (com fallback para o caso em que cabeçalho e valores caem na mesma linha reconstruída).
  - Em ambos os casos `c.prazoPagamento` é uma string que pode conter um ou mais números separados por `/`.
- `confRenderResultados` compara a lista de dias extraída do PDF (`campos.prazoPagamento.split("/")`) com a lista cadastrada (`item.prazoCadastradoTodos`, vindo de `prazoPagamentoDiasTodos`): listas iguais (mesmo tamanho e mesma ordem) → badge "confere"; tamanhos/valores diferentes → "divergente" (mostra ambas as listas, ex: `pedido 60/90 dias × cadastro 90 dias` — sinaliza cadastro legado ainda não migrado para o formato parcelado); só um dos dois lados tem dado → aviso de "sem cadastro" ou "não encontrado no pedido".

---

## Lógica da calculadora

Fórmula proporcional: `(entrada / MedidaBase) × Preco`

- **metros**: entrada = nova largura em mm; base = largura cadastrada em mm
- **pares / peças**: entrada = novo tamanho em cm; base = tamanho cadastrado em cm

Na **conferência de pedidos (PDF)**, `metros` e `kg` usam **preço direto** (preço único, sem cálculo); apenas `pares`/`peças` aplicam a fórmula proporcional acima. `kg` tem a mesma função de `metros` — é preço único por quilo e **não usa MedidaBase**. A decisão de tipo (`unidadeDireta`/`unidadeKg` no frontend) prioriza o rótulo da MedidaBase (`CM` → proporcional; `MM` → direto) e cai na coluna Unidade quando o rótulo não indica.

---

## Schema da aba VENDEDORES

| Coluna | Nome     |
|--------|----------|
| A      | ID       |
| B      | Nome     |
| C      | Senha    |
| D      | Clientes (separados por `|`, ou `*` para acesso total) |
| E      | Email    |

---

## Fluxo de autenticação

Acesso admin = vendedor cuja coluna D contém `*`. Apenas admins veem as abas "Cadastrar" e "Admin" na interface.

---

## Padrão de comunicação frontend ↔ backend

```javascript
// frontend chama função GAS assim:
gas("nomeDaFuncao", arg1, arg2).then(resultado => { ... });

// todas as funções retornam { ok: true, ... } ou { ok: false, erro: "..." }
```

---

## Regra crítica: parsing de números

**Toda vez que ler ou salvar um valor numérico — vindo de planilha, de input do usuário ou de qualquer fonte externa — use o helper `pN` para converter:**

```javascript
// No backend (Codigo.gs):
const pN = v => parseFloat(String(v || "0").replace(",", ".")) || 0;

// No frontend (Index.html), para inputs do usuário:
parseFloat(String(valor).trim().replace(",", ".")) || 0
```

**Por quê isso importa:**
- Google Sheets pode armazenar a célula como **Texto** quando o usuário digita diretamente; nesse caso `getValues()` retorna a string `"10,50"` e `Number("10,50")` retorna `NaN`.
- Usuários brasileiros digitam vírgula como separador decimal (`"10,50"`), que `parseFloat` nativo também não entende.
- `Number(preco) || 0` sem o `.replace(",", ".")` **silenciosamente zera preços válidos**.

**Regras práticas:**
1. No backend, nunca use `Number(x)` diretamente sobre valores vindos de `getValues()` — sempre use `pN(x)`.
2. No frontend, `calcular()` já faz `.replace(",", ".")` antes do `parseFloat` — mantenha esse padrão em qualquer nova função de cálculo.
3. Inputs de preço no formulário devem ter `type="text" inputmode="decimal"` (não `type="number"`) para aceitar vírgula.
4. Ao injetar valores numéricos em strings HTML (ex: atributos `onclick`), garanta que vieram de `pN()` no backend — isso assegura que são JS Numbers puros, sem vírgula ou símbolo de moeda.

---

## Aba "Conferir" — conferência de pedidos em PDF

A aba Conferir do `Index.html` lê uma ou mais ordens de compra em PDF inteiramente no navegador (pdf.js via CDN — nenhuma função nova de backend):

### Suporte a múltiplos PDFs

O input `#conf-file` tem `multiple` e o drop-zone aceita varios arquivos de uma vez. Cada PDF e processado **sequencialmente** (um por vez, sem paralelismo) e gera um item independente em `S.confItens` (`{id, arquivo, linhas, campos, cliente, uf, resultados, prazoCadastrado, erro, clientesDisponiveis}`):

- `confArquivosSelecionados(files)` — ponto de entrada (chamado pelo `onchange`/`ondrop`). Para cada arquivo: extrai linhas (`confExtrairLinhas`), `confParseCampos`, detecta o cliente comparando com a lista de `getClientes` (chamada **uma única vez** para o lote inteiro) e empilha o item em `S.confItens`. Em seguida, para os itens com cliente detectado, roda a analise automaticamente via `confExecutarAnalise`, reaproveitando `getReferencias` entre PDFs do mesmo cliente atraves de um cache local ao lote (`refsCache`).
- `confExecutarAnalise(item,aba,uf,cache)` — busca a tabela do cliente (`getReferencias`) e roda `confExtrairBlocos`/`confValidar` para aquele item, gravando `item.resultados`/`item.prazoCadastrado`. Sem `cache`, sempre busca a tabela atual (usado pelo botao manual).
- `confAnalisarItem(id)` — chamado pelo botao "Conferir Precos" de um item especifico; le `#conf-cliente-<id>`/`#conf-uf-<id>`, chama `confExecutarAnalise` sem cache e re-renderiza.
- `confRenderTudo()`/`confRenderItem(item,idx)`/`confRenderResultados(item)` — renderizam `#conf-result` como uma lista de blocos `.conf-pdf-block`, um por PDF, cada um com cabecalho (nome do arquivo, OC/marca/emissao), seletor de cliente/UF proprio e o resumo+cards daquele item. `confRemoverItem(id)`/`confLimparTudo()` removem um item ou todos.

A logica de extracao/validacao por PDF abaixo (itens 1-5) e a mesma de antes, apenas executada uma vez por item da lista:

1. `confExtrairLinhas` reconstrói as linhas visuais por coordenada — usa `pdfjsLib.Util.transform` com o viewport da página, obrigatório para PDFs em paisagem/rotacionados (caso das OCs da DASS).
2. `confParseCampos` detecta nº da OC, marca, data de emissão e UF da tabela (`/CE`, `/BA` etc. próximo de "MARFIM" no bloco do fornecedor). O cliente é detectado comparando o texto com os nomes das abas de cliente.
3. `confExtrairBlocos` divide o texto em blocos de item delimitados pela linha `Quantidade:`. `confParseItemBloco` extrai o tamanho (`65CM/288` → cm), a quantidade e o preço unitário (preferência: `Vlr. total ÷ Qtde total`; fallback: valor logo após a data de Prev. Ent.).
4. `confValidar` casa cada bloco com as referências do cliente e escolhe a linha da tabela via `confEscolherVigencia`, que filtra pelas linhas cuja vigência cobre a data de emissão (se nenhuma cobrir, usa a mais recente e marca `VENCIDO`). **Múltiplas linhas vigentes para a mesma referência/goma** (variantes de tamanho com preços próprios, não proporcionais entre si): `confEscolherVigencia` recebe o tamanho do pedido (`item.cm`/`item.mm`) e, havendo mais de uma linha vigente, prioriza a que tem `MedidaBase` igual ao tamanho do pedido — só cai no critério de data (mais recente) se nenhuma casar exatamente. Se a linha escolhida não tiver preço para a UF/base, busca a vigência anterior com preço da **mesma MedidaBase** (evita misturar o preço de outra variante de tamanho); se achar, usa esse preço e avisa o usuário das duas vigências (`vigenciaAnterior`). **Cálculo por tipo de produto**: pares/peças são vendidos por tamanho → `esperado = (tamanho_cm ÷ MedidaBase) × preço da UF` (ex.: base 100cm a R$ 1,95 → 65cm = R$ 1,27); metros (e **`kg`**, preço único por quilo) têm preço direto, **sem cálculo** — `unidadeDireta()` cobre ambos. O rótulo da MedidaBase (`"100 CM"`, `"10mm"`) tem prioridade sobre o campo Unidade para decidir o tipo (corrige cadastros legados). **Comparação de preço em centavos com igualdade exata** (`confPrecoConfere`/`confCentavos`): os dois lados são arredondados para 2 casas — inclusive um eventual 3º decimal vindo do PDF (`0,015 → 0,02`, via `+1e-9` no arredondamento) — e devem bater **100%**; qualquer diferença ≥ 1 centavo é `DIVERGENTE` (não há margem de tolerância — decisão do cliente). Regras de casamento (`confRefRegex`):
   - A referência é identificada pelo **início do código**: a descrição embutida entre parênteses no cadastro é ignorada (`M21048(elást.red.2,5mm tranç.16f.)` → casa por `M21048`), e `M2173` casa com `M2173.114` e `M2173 BRANCO`, mas **não** com `M21730` (dígito a mais = outro código).
   - Separadores espaço/ponto/barra/hífen são tolerados dentro do código (`MR110022` ↔ `MR 110022`, `MFGP/T2` ↔ `MFGPT2`).
   - **Rótulo "REF" colado sem separador** (ex.: pedido traz `REF15051/P`, cadastro tem `15051/P`): `confRefRegex` aceita `REF` (case-insensitive) como alternativa ao limite início-de-código, além do caractere não alfanumérico já tolerado. Exige `\b` antes de `REF` para não casar como prefixo de outra palavra (ex.: `PREF1234` não deve casar código `1234`).
   - **Atributo goma** (`confTemGoma`/`confBaseRef`): variantes com/sem goma do mesmo código são candidatas distintas. O PDF pode indicar goma como `C/GOMA`, `engomada`, `engomado`, `egomada`, `engo`, `gomada`; negações (`S/GOMA`, `sem goma`) contam como sem goma. O atributo pode estar na referência cadastrada (ex.: `MFGP/T2 C/Goma`) ou só na Descricao. Empate de código é decidido pela variante cujo atributo coincide com o pedido; se divergir, um aviso é exibido no resultado.
5. Status possíveis: `OK`, `DIVERGENTE`, `VENCIDO`, `SEM_PRECO`, `SEM_MEDIDA`, `NAO_CADASTRADO`.
   - **`NAO_CADASTRADO` — motivo detalhado no card** (vale para todos os clientes, atuais e futuros): quando nenhum candidato casa por completo, `confValidar` distingue dois casos no `res.motivo`/`refNome`: (a) **código-base existe, variante de medida não** — algum candidato com `rxBase` casa o bloco mas o `rxMm` não (ex.: PDF `M12021 8MM`, tabela só tem `M12021 6MM`); o card mostra o código-base, as medidas cadastradas e a medida que o pedido pede (`confMedidaPdf` pega o token `<n>MM` mais próximo do código, preterindo ponteiras distantes como `20MM`); (b) **referência inexistente** — nenhum `rxBase` casa; mensagem deixa claro que nenhum código compatível foi encontrado.

O parsing foi calibrado com as OCs da DASS, da RAMARIM e da DILLY (PDFs de exemplo na raiz do repositório).

### Suporte multi-formato: DASS vs RAMARIM vs DILLY

`confIsRamarim(linhas)` detecta o formato pelo cabeçalho ("CALCADOS RAMARIM" / "RAMARIM - NOVA HARTZ") e `confIsDilly(linhas)` detecta o formato DILLY pelo cabeçalho "Forma de Abertura" combinado com **um dos dois** rodapés observados: "Emitido por Safetech" **ou** a tabela "Previsão" (cabeçalhos "Dias Parcela" + "Valor Parcela") — ver variantes de rodapé na seção DILLY abaixo. `confExecutarAnalise` seleciona o extrator e o parser corretos para cada formato; `confValidar` aceita um `parseFn` opcional (5º argumento) para suportar ambos. A ordem de detecção em `confParseCampos` é RAMARIM → DILLY → DASS (default).

**Formato RAMARIM** (tabela em paisagem, OCs série PED_XXXXXX):
- Cabeçalho: `NÚMERO OC: XXXXXX` / `DATA EMISSÃO: DD/MM/YYYY` / `COND. PGTO: N dias`
- UF: extraída do bloco do **fornecedor** (Marfim), mesmo padrão do DASS: `MARFIM[\s\S]{0,200}?\/\s*(RS|BA|CE|MG)`. Marfim tem filiais em RS, BA e CE — a UF capturada reflete qual filial está como fornecedor no PDF. O endereço do cliente (ex: `JEQUIE/BA`) é ignorado. Fallback: qualquer `/ESTADO` no trecho após `FORNECEDOR:` (evita capturar endereço do comprador).
- Cada linha de item: `SEQ ATAxxxxxxx DESCRICAO... DD/MM/YYYY QTY PR PRECO TAM TOTAL`
- Extrator: `confExtrairBlocosRamarim` — seleciona linhas que iniciam com `\d{1,3} ATA\d+`. **Linha dividida — dois casos**: (A) descrição na linha ATA sem data, dados na linha seguinte (PED_442281); (B) dados na linha anterior (Remessa), descrição na linha ATA sem data (PED_443125). O extrator testa ambos os sentidos e une as linhas antes de empilhar. Ruído `"Quantidade Total por Remessa: N"` embutido na linha ATA é removido antes da detecção. Blocos sem data ou sem `PR` são descartados.
- Parser: `confParseItemBlocoRamarim` — extrai preco (`Vl. Unit.`), qty (`Quant.`) e tamanho cm do **final da descrição** (`50CM`, `120CM`, etc.)
- Referências: o código Marfim fica embutido na descrição (ex: `LS 16410`, `M 1308`, `M 34003`); o `confRefRegex` casa normalmente contra a linha inteira do item. Código sem espaço na planilha (ex: `LS16410`) já casa com `LS 16410` no PDF via `[\s./\-]*` do regex — não é necessário cadastrar o espaço.
- **Aliases via `ant.`**: `confValidar` extrai automaticamente códigos antigos mencionados como `ant.CODIGO` na parte entre parênteses da referência cadastrada. Ex: `M12192(cad.tear... ant.M1308)` → cria alias `M1308` apontando para as mesmas rows, permitindo que PDFs com o código antigo sejam conferidos sem alterar o cadastro.
- Unidade: todos os itens são `PR` (pares); o cálculo proporcional usa `(tamanho_cm / MedidaBase) × preço`.

**Formato DASS** (blocos de texto, OCs digitalizadas/geradas pelo ERP da DASS):
- Delimitador de bloco: linha `Quantidade:`
- Extrator: `confExtrairBlocos` / Parser: `confParseItemBloco` (comportamento original, sem alteração).

**Formato DILLY** (ERP Safetech, OCs série `OC_XXXXXX`, cliente DILLY):
- Detecção: `confIsDilly` (marcadores do layout/ERP, **não** o nome do cliente — assim suporta outros clientes que usem o mesmo ERP no futuro). Exige sempre o cabeçalho `Forma de Abertura`; aceita **dois** rodapés alternativos observados na prática — **(1)** `Usuário: F4515_MARFIMRS ... Emitido por Safetech Informática LTDA.` (modelo de impressão "completo", ex. `OC_473864`/`OC_477450`/`OC_482415`) **ou** **(2)** apenas `Usuário: <nome_comprador> ...` sem menção a "Safetech" (modelo "reduzido", ex. `OC_392730`) — neste caso a tabela "Previsão" (`Dias Parcela` + `Valor Parcela`) é o sinal usado para confirmar o formato, já que está presente em ambos os modelos e é exclusiva da DILLY. **Achado real**: a OC 392730 não era lida pelo sistema (nenhum item extraído, campos de cabeçalho vazios) porque seu rodapé não tem "Safetech" — `confIsDilly` exigia esse texto e a OC caía no parser DASS (que delimita itens por `Quantidade:`, ausente neste formato), zerando a extração. Corrigido tornando "Safetech" **um dos** sinais aceitos, não o único.
- **Cabeçalho** (implementado em `confParseCampos`, ramo DILLY):
  - Nº OC: `Ordem Compra <N>` → `/Ordem\s+Compra\s+(\d+)/i`
  - Data de emissão: `Data Emissão: DD/MM/YYYY` → `/Data\s+Emiss\S+\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i`
  - **Marca**: linha `OBS.: Marca: SKECHERS Ref.:... Mod.:...` → `/Marca\s*:\s*(.+?)\s+Ref\.?\s*:/i` (captura entre `Marca:` e `Ref`; suporta marca com mais de uma palavra). A marca varia por pedido (validado em `SKECHERS` e `MORMAII`) e fica disponível para a conferência dos itens (ver desambiguação por marca abaixo).
  - **UF** = filial Marfim fornecedora (define a coluna de preço, **não** a UF da DILLY): sinal primário é o código de usuário do rodapé `Usuário: F628_MARFIMCE` → `/MARFIM\s*(RS|BA|CE|MG)\b/i`; fallback `Cidade: <cidade> - <UF>` do bloco do fornecedor. Observação: o padrão `MARFIM…/UF` (com barra) usado por DASS/RAMARIM **não** ocorre neste formato.
  - Cliente: detectado pelo mecanismo padrão (nome da aba casado contra o texto; "DILLY" aparece no comprador e no rodapé).
- **Itens** (implementado): Extrator `confExtrairBlocosDilly` / Parser `confParseItemBlocoDilly`; `confExecutarAnalise` roteia DILLY para esse par e reusa `confValidar`. PDFs de exemplo: `OC_435918`, `OC_454831`, `OC_465813`, `OC_470796`, `OC_480965`, `OC_392730` (rodapé "reduzido", sem "Safetech" — ver detecção acima).
  - **Estrutura de um item após `confExtrairLinhas`**: cada item ocupa várias linhas. A **linha-âncora** traz `<qtd>,XX <preco>,XX <ipi> <DD/MM/YYYY>` + a descrição; as linhas seguintes trazem `<codigo> <seq> PR`, a cor, e o campo `Tamanho <N>`. `confExtrairBlocosDilly` delimita um bloco de uma âncora até a próxima (regex âncora: `/\d{1,3}(?:\.\d{3})*,\d{2}\s+\d+,\d{2}\s+[\d.,]+\s+\d{2}\/\d{2}\/\d{4}/`). Linhas `Lote:`/`Item` intermediárias caem como ruído inofensivo.
  - **Dois eixos de layout independentes** (ambos cobertos pelo mesmo par extrator/parser):
    - *Onde está o tamanho*: **(A) na descrição** (`...M21020 PES 95CM ...`, campo *Tamanho* = `1`) — ex. `OC_435918`, `OC_454831`; ou **(B) na grade** (descrição diz `C/ GRADE` sem cm; tamanho real no campo **Tamanho**: 105/120/125...) — ex. `OC_465813`, `OC_470796`, `OC_480965`. `confParseItemBlocoDilly` prioriza `NNcm` na descrição e cai para `Tamanho <N>` quando não há cm.
    - *Lotes*: itens repetidos em blocos `Lote: <N>` em várias páginas (`OC_454831`, `OC_465813`, `OC_470796`) **ou** lista única sem lotes (`OC_435918`, `OC_480965`).
  - **Espessura (MM) discrimina linhas da tabela** — resolvido pelo mecanismo existente `rxBase`+`rxMm` do `confValidar`: o código `M21020` tem variantes 6/7/8MM (preço próprio; ex. CE: 8MM = 0,57; 6MM = 0,56). Como a referência cadastrada é `M21020 8MM (...)`, o `confValidar` exige que o bloco contenha **tanto** `M21020` quanto `8MM` (presente em `CHATO 8MM`); um pedido 6MM não casa com a linha 8MM e vice-versa. A ponteira `20MM` não colide (regex exige o dígito exato antes de `MM`).
  - **Cálculo**: par (`PR`), base 100cm → `esperado = (tamanho_cm / 100) × preço da UF`; comparação em centavos com igualdade exata (`confPrecoConfere`): o esperado é arredondado para 2 casas e deve bater 100% com o preço do pedido.
  - **Validação nos exemplos** (UF=CE): `OC_480965` (8MM, base CE 0,57) → 6/6 **OK** (120cm 0,68 · 125cm 0,71 · 130cm 0,74 batem 100% após arredondar). Os 4 PDFs **6MM** dão **DIVERGENTE em todos os itens**: os pedidos embutem base ≈ 0,57, mas o CE 6MM cadastrado é 0,56 — diferença de ~1 centavo, agora sempre sinalizada (comparação exata em centavos). É **achado de dado real** (rever o preço CE da `M21020 6MM` para 0,57), não bug do parser.
  - **Marca** (`MORMAII`/`SKECHERS`, do cabeçalho) também aparece na Descricao das linhas da tabela (`...preto/cores Mormaii`) — disponível para desambiguar quando código + espessura empatarem (uso futuro).
  - **Prazo**: o pagamento DILLY é em 2 parcelas iguais (50%/50% do total), tabela "Previsão" → "Dias Parcela"/"Valor Parcela" na última página, tipicamente `60`/`90 dias` — modelo diferente do "N dias" único de DASS/RAMARIM. Extraído por `confParseCampos` como `prazoPagamento="60/90"` e comparado em `confRenderResultados` contra `prazoPagamentoDiasTodos` cadastrado na célula S1 (ver seção "Célula S1" acima). `Situação` pode ser `Aberta` ou `Recebida` (não afeta o parser).
  - Outras observações: cor codificada (`BRANCO 102` / `PRETO 100` — 100/102 são cor, não tamanho); `Situação` pode ser `Aberta` ou `Recebida`; pagamento em parcelas (60/90 dias) — modelo diferente do "N dias" de DASS/RAMARIM, tratar prazo depois.

---

## Regra crítica: segurança no frontend

**Nunca injete dados da planilha diretamente em `innerHTML` sem escapar:**

```javascript
// ERRADO — XSS se o campo contiver HTML:
el.innerHTML = "<div>" + ref.descricao + "</div>";

// CORRETO — sempre use escHtml():
el.innerHTML = "<div>" + escHtml(ref.descricao) + "</div>";
```

A função `escHtml` já existe no `Index.html` e escapa `&`, `<`, `>`, `"`. Use-a em **todos** os campos de texto de origem externa antes de inserir em HTML, inclusive em modais, tooltips e impressão.
