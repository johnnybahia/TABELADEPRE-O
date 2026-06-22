# Tabela de Preços Marfim — Guia para IAs

## Visão geral

Aplicação Google Apps Script (GAS) com dois arquivos:
- `Codigo.gs` — backend (funções GAS chamadas pelo frontend via `google.script.run`)
- `Index.html` — frontend SPA (HTML/CSS/JS inline)

Dados persistidos em Google Sheets. Cada cliente tem uma aba própria com sufixo ` CLIENTE`.

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

Itens sem Unidade/MedidaBase (legados) são tratados como `metros` com cálculo direto `preco × entrada`.
Preços por estado são opcionais; quando zero/ausentes, o frontend usa o Preco base.

### Células T1/U1/V1 — Variação de preço por estado (metadado, fora do SCHEMA_CLIENTE)

As células **T1** (BA), **U1** (CE) e **V1** (MG) de cada aba de cliente armazenam a variação percentual de preço em relação ao RS. Não fazem parte do `SCHEMA_CLIENTE` e não são afetadas por `migrarSchema()`.

- Armazenadas como número puro (ex: `-3` para −3%, `5` para +5%). Célula vazia = sem auto-preenchimento para aquele estado.
- Zero e célula vazia são equivalentes (sentinel value).
- Fórmula: `precoEstado = precoRS × (1 + variação/100)`. Negativo = desconto; positivo = acréscimo.
- Lidas em batch por `getReferencias` via `getRange("T1:V1").getValues()` + `pN()`; retornadas como `descontoBA`, `descontoCE`, `descontoMG`.
- Escritas em batch por `salvarDescontosEstado` via `getRange("T1:V1").setValues(...)`.
- Visíveis na aba "Cadastrar" (admin), linha "Variação por estado (% sobre RS): BA/CE/MG [Salvar variações]".
- `autoFillEstados(rsId, baId, ceId, mgId)` no frontend aplica os valores ao digitar no campo RS; limpa os campos dos estados quando RS é apagado.

### Célula S1 — Prazo de pagamento (metadado, fora do SCHEMA_CLIENTE)

A célula **S1** de cada aba de cliente armazena o prazo de pagamento no formato `"<N> dias"` (ex: `"90 dias"`) ou, para pagamento em parcelas, `"<N1>/<N2> dias"` (ex: `"60/90 dias"`, caso DILLY). Não faz parte do `SCHEMA_CLIENTE` (que cobre apenas A-M) e não é afetada por `migrarSchema()`.

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
   - **Atributo goma** (`confTemGoma`/`confBaseRef`): variantes com/sem goma do mesmo código são candidatas distintas. O PDF pode indicar goma como `C/GOMA`, `engomada`, `engomado`, `egomada`, `engo`, `gomada`; negações (`S/GOMA`, `sem goma`) contam como sem goma. O atributo pode estar na referência cadastrada (ex.: `MFGP/T2 C/Goma`) ou só na Descricao. Empate de código é decidido pela variante cujo atributo coincide com o pedido; se divergir, um aviso é exibido no resultado.
5. Status possíveis: `OK`, `DIVERGENTE`, `VENCIDO`, `SEM_PRECO`, `SEM_MEDIDA`, `NAO_CADASTRADO`.
   - **`NAO_CADASTRADO` — motivo detalhado no card** (vale para todos os clientes, atuais e futuros): quando nenhum candidato casa por completo, `confValidar` distingue dois casos no `res.motivo`/`refNome`: (a) **código-base existe, variante de medida não** — algum candidato com `rxBase` casa o bloco mas o `rxMm` não (ex.: PDF `M12021 8MM`, tabela só tem `M12021 6MM`); o card mostra o código-base, as medidas cadastradas e a medida que o pedido pede (`confMedidaPdf` pega o token `<n>MM` mais próximo do código, preterindo ponteiras distantes como `20MM`); (b) **referência inexistente** — nenhum `rxBase` casa; mensagem deixa claro que nenhum código compatível foi encontrado.

O parsing foi calibrado com as OCs da DASS, da RAMARIM e da DILLY (PDFs de exemplo na raiz do repositório).

### Suporte multi-formato: DASS vs RAMARIM vs DILLY

`confIsRamarim(linhas)` detecta o formato pelo cabeçalho ("CALCADOS RAMARIM" / "RAMARIM - NOVA HARTZ") e `confIsDilly(linhas)` detecta o formato DILLY pelos marcadores do ERP Safetech ("Forma de Abertura" + "Emitido por Safetech"). `confExecutarAnalise` seleciona o extrator e o parser corretos para cada formato; `confValidar` aceita um `parseFn` opcional (5º argumento) para suportar ambos. A ordem de detecção em `confParseCampos` é RAMARIM → DILLY → DASS (default).

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
- Detecção: `confIsDilly` (marcadores do layout/ERP, **não** o nome do cliente — assim suporta outros clientes que usem o mesmo ERP no futuro).
- **Cabeçalho** (implementado em `confParseCampos`, ramo DILLY):
  - Nº OC: `Ordem Compra <N>` → `/Ordem\s+Compra\s+(\d+)/i`
  - Data de emissão: `Data Emissão: DD/MM/YYYY` → `/Data\s+Emiss\S+\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i`
  - **Marca**: linha `OBS.: Marca: SKECHERS Ref.:... Mod.:...` → `/Marca\s*:\s*(.+?)\s+Ref\.?\s*:/i` (captura entre `Marca:` e `Ref`; suporta marca com mais de uma palavra). A marca varia por pedido (validado em `SKECHERS` e `MORMAII`) e fica disponível para a conferência dos itens (ver desambiguação por marca abaixo).
  - **UF** = filial Marfim fornecedora (define a coluna de preço, **não** a UF da DILLY): sinal primário é o código de usuário do rodapé `Usuário: F628_MARFIMCE` → `/MARFIM\s*(RS|BA|CE|MG)\b/i`; fallback `Cidade: <cidade> - <UF>` do bloco do fornecedor. Observação: o padrão `MARFIM…/UF` (com barra) usado por DASS/RAMARIM **não** ocorre neste formato.
  - Cliente: detectado pelo mecanismo padrão (nome da aba casado contra o texto; "DILLY" aparece no comprador e no rodapé).
- **Itens** (implementado): Extrator `confExtrairBlocosDilly` / Parser `confParseItemBlocoDilly`; `confExecutarAnalise` roteia DILLY para esse par e reusa `confValidar`. PDFs de exemplo: `OC_435918`, `OC_454831`, `OC_465813`, `OC_470796`, `OC_480965`.
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
