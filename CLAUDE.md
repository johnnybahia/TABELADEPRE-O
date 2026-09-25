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

### Configurar um cliente novo com o mesmo sistema de preço de outro

`copiarConfigCliente(nomeAbaOrigem, nomeAbaDestino)` (rodar pelo editor do Apps Script, sem token) copia de uma aba de cliente para outra os metadados que definem **como o preço é calculado** — e **nada de preços/itens**:

- **S1** — prazo de pagamento (`"90 dias"`, `"60/90 dias"`)
- **T1/U1/V1** — variação % de BA / CE / MG sobre o preço RS (nos clientes "preço duplo": RS/RS e CE/CE sobre o preço base RS/CE)
- aplica os cabeçalhos faltantes do `SCHEMA_CLIENTE` na aba de destino (via `_aplicarSchemaAba`, o mesmo helper usado por `migrarSchema()`) e o formato `dd/MM/yyyy` em DataInicio/DataFim — útil quando a aba foi criada à mão, e não pelo formulário "Novo Cliente"
- replica os rótulos das colunas de preço **I–L** (ex.: `PrecoRS/CE`, `PrecoRS/RS`, `PrecoCE/CE` nos clientes "preço duplo"), preservando rótulo já personalizado no destino. O texto do cabeçalho é apenas visual — o código lê por posição

Recusa copiar entre modelos de preço diferentes (cliente comum × cliente "preço duplo"), porque T1/U1/V1 têm papéis distintos nos dois. Idempotente; log `COPIAR_CONFIG_CLIENTE`.

Atalho pronto: **`configurarAnigerComoDakota()`** — configura `ANIGER CLIENTE` a partir de `DAKOTA CLIENTE` (preço duplo: base RS/CE na coluna I, RS/RS e CE/CE = +14% via T1/U1). Exige `"ANIGER"` em `CLIENTES_PRECO_DUPLO` — já incluído.

Nada além disso é necessário no código para um cliente novo do modelo **por estado**: `getClientes` descobre automaticamente qualquer aba terminada em ` CLIENTE` e esse é o comportamento padrão. Para o modelo **preço duplo** é obrigatório também incluir o nome do cliente (sem o sufixo ` CLIENTE`) em `CLIENTES_PRECO_DUPLO` no `Codigo.gs` — é ele que troca o papel das colunas I/J/K, os rótulos da interface e a regra de "preço atual". Em ambos os casos, falta ainda dar acesso ao vendedor na coluna D da aba `VENDEDORES` (ou `*` para admins).

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

Itens sem Unidade/MedidaBase (legados) são tratados como `metros` com cálculo direto `preco × entrada`.
Preços por estado são opcionais; quando zero/ausentes, o frontend usa o Preco base.

**Atenção (colunas legadas N/O/P):** as abas antigas importadas trazem cabeçalhos legados `Custo/RS` (N), `Custo/BA/CE` (O) e `nov./22` (P) — e, em DASS/RAMARIM, ainda há **dados** de custo nessas colunas. `migrarSchema()` não sobrescreve cabeçalho ocupado, mas o código lê/escreve **por posição**: N é tratada como `PrecoAtivo` independentemente do texto do cabeçalho (valores legados de custo em N fazem a linha parecer "preço ativado"). O e P estão fora do schema e não são tocadas pelo código; o ideal é mover os custos legados para colunas além do schema (ex.: AA em diante) e renomear N1 para `PrecoAtivo`.

### Clientes "preço duplo" (origem/destino) — DAKOTA e ANIGER

Configurados na lista `CLIENTES_PRECO_DUPLO` em `Codigo.gs` (nome do cliente sem o sufixo ` CLIENTE`; helper `_ehPrecoDuplo(nomeAba)`; o frontend recebe o flag em `getReferencias().precoDuplo` e o guarda em `S.consPrecoDuplo`/`S.cadPrecoDuplo`). Nesses clientes:

- **As colunas de preço por estado mudam de papel** (mesma ordem dos cabeçalhos renomeados na planilha do cliente): **I (PrecoRS) = RS/CE**, **J (PrecoBA) = RS/RS**, **K (PrecoCE) = CE/CE**; **L (PrecoMG) não é usada** (campo oculto na interface). Os rótulos vêm de `rotulosPreco(duplo)` no `Index.html` (rótulo `null` = coluna oculta) e valem para consulta, calculadora, histórico, impressão e emails.
- **O preço base é o próprio RS/CE (coluna I)** — não existe campo nem coluna separados. As variações % de RS/RS e CE/CE sobre ele usam o **mecanismo padrão T1/U1** (V1/MG não é usada): apenas os rótulos mudam na interface ("Variação sobre o preço base RS/CE (%): RS/RS / CE/CE"). `autoFillEstados` funciona normalmente: digitar o RS/CE preenche RS/RS (T1) e CE/CE (U1).
- **Botão "🔄 Aplicar em todos"** (um acima de cada percentual, visível só no modo duplo): recalcula a coluna inteira na planilha via `aplicarVariacaoColuna(nomeAba, alvo, percentual, token)` (admin; alvo `"rsrs"` = coluna J, `"cece"` = coluna K): para cada linha com base RS/CE > 0 **e que já tem preço na coluna alvo**, grava `novo = RS/CE × (1 + pct/100)` arredondado em centavos (célula vazia = item sem preço nessa modalidade, permanece vazia); o percentual também é salvo em T1/U1. Serve para reajustes para cima ou para baixo (pct negativo). Log: `APLICAR_VARIACAO_COLUNA`. O frontend pede `confirm` antes (`aplicarVariacaoColunaCad`).
- **Regra de "preço atual" por descrição**: vale para todo cliente (não é exclusiva daqui) — ver seção "Regra de 'Preço atual' e ativação manual" abaixo.
- A conferência (aba "Conferir") suporta os dois: **DAKOTA** por arquivos-texto `.dkn`/`.dke`/`.htm` e **ANIGER** por arquivo-texto `.edi` — cada um com seu leitor próprio (os layouts são diferentes), mas ambos com detecção automática da modalidade RS/RS·RS/CE·CE/CE por CNPJ e o fluxo de "ensinar associação". Ver as seções **"Aba 'Conferir' — formato DAKOTA"** e **"Aba 'Conferir' — formato ANIGER"** abaixo. O que é comum aos dois é só o CNPJ da própria Marfim (`CONF_MARFIM_CNPJ`, `confOrigemMarfim`) e as funções de modalidade (`confModalidadeDuplo`/`confModalUf`); o CNPJ do comprador e o leitor de arquivo são de cada cliente.
- **ANIGER** (adicionada em 2026-08): mesmo modelo da DAKOTA. Configuração da aba feita por `configurarAnigerComoDakota()` (ver "Configurar um cliente novo com o mesmo sistema de preço de outro" acima).

### Regra de "Preço atual" e ativação manual (coluna PrecoAtivo)

O "Preço atual" de cada variante (`Referencia + MedidaBase + Descricao` — `refVarianteKey` no `Index.html`, válido para **todo cliente**, não só "preço duplo") é decidido automaticamente: linha **vigente** com a **DataInicio mais recente** (`calcAtualPorRef`). A mesma referência com **descrições diferentes** são itens distintos — **cada um com seu próprio preço atual, todos ficam ativos automaticamente** (ex.: DILLY `M16063` "ponto trabalhado" R$1,27 × "com ponteira personalizada" R$1,73, mesma MedidaBase e DataInicio). Além disso, linhas com `PrecoAtivo = 1` **e ainda vigentes** também são tratadas como ativas (`refEhAtual`): recebem o badge "📌 Preco ativado", a calculadora e aparecem como ativas na impressão.

A ativação manual continua existindo para o caso residual em que nem a descrição diferencia — duas linhas vigentes com `Referencia + MedidaBase + Descricao` **idênticos** (ex. real: `M13501`/`M4140` da DILLY, provável inconsistência de planilha) — aí a regra automática só pode marcar uma como atual (empate) e o admin decide se a outra deve permanecer ativa mesmo assim.

- Botão "📌 Ativar preco" / "Desativar preco" nos cards das listas (consulta e Cadastrar), visível **apenas para admins** (coluna D = `*`); backend `setPrecoAtivo(nomeAba, linha, ativo, token)` valida admin via `_ehAdmin` e grava `1`/vazio na coluna N.
- `salvarReferencia` preserva a marcação ao editar a linha; `renovarReferencia` **não** herda a marcação para a nova vigência (ela já vira o preço atual automático).
- Marcação em linha fora de vigência é ignorada pelo frontend (linha vencida nunca fica ativa).

### Conflito de vigência no cadastro (modal "Referencia ja cadastrada")

O bloqueio de cadastro repetido não é mais um erro seco. `salvarReferencia(nomeAba, dados, token, linhaEdicao, modoConflito)` detecta sobreposição de vigência **por variante** (mesma `Referencia` **e** mesma `MedidaBase`, comparadas via `pN` — mesmo critério de `refVarianteKey`/`confEscolherVigencia`; medidas diferentes são variantes de tamanho legítimas e coexistem sem aviso) **e** mesma `Descricao` (trim+uppercase) — descrição diferente é item distinto e salva direto, sem modal, coexistindo ativo (válido para todo cliente). Quando `Referencia + MedidaBase + Descricao` coincidem, responde conforme `modoConflito`:

- **vazio/null** — não grava nada; retorna `{ ok:false, conflito:true, conflitos:[{linha, ref, descricao, obs, dataInicio, dataFim}] }`. O frontend (`cadSalvarReferencia`) abre o modal `#modal-conflito` listando as linhas conflitantes com três saídas: Atualizar preço, Cadastrar item repetido, Cancelar.
- **`"atualizar"`** — atualização de preço pelo formulário: encerra a vigência das linhas conflitantes (`DataFim = nova DataInicio − 1 dia`, como `renovarReferencia`) e cadastra a linha nova, que vira o preço atual automático. Só para cadastro novo (erro na edição); também dá erro se alguma linha conflitante tiver `DataInicio` igual/posterior à nova (o encerramento geraria vigência invertida).
- **`"duplicar"`** — cadastro repetido deliberado (**admin apenas**, caso "mesmo item, mesma descrição, observações diferentes" — descrição diferente já coexiste sem passar por aqui, ver acima): grava a linha nova **já com `PrecoAtivo = 1`** e marca `PrecoAtivo = 1` também nas linhas conflitantes — os dois preços permanecem ativos (badge "📌 Preco ativado") mesmo com a data nova, via o mecanismo de ativação manual acima. Na **edição** de uma linha repetida existente (o conflito com a linha irmã dispararia o bloqueio e tornaria duplicados ineditáveis), `"duplicar"` apenas libera o salvamento, preservando as marcações de cada linha como estão.

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
- **Clientes "preço duplo"** (ex. DAKOTA) usam as **mesmas células com papel trocado**: T1 = variação de **RS/RS** e U1 = variação de **CE/CE**, % sobre o **preço base RS/CE** (coluna I); V1 não é usada. O botão "Aplicar em todos" (`aplicarVariacaoColuna`) recalcula a coluna correspondente inteira e regrava T1/U1 (ver seção "Clientes 'preço duplo'" acima).

### Célula S1 — Prazo de pagamento (metadado, fora do SCHEMA_CLIENTE)

A célula **S1** de cada aba de cliente armazena o prazo de pagamento no formato `"<N> dias"` (ex: `"90 dias"`) ou, para pagamento em parcelas, `"<N1>/<N2> dias"` (ex: `"60/90 dias"`, caso DILLY). Não faz parte do `SCHEMA_CLIENTE` (que cobre apenas A-N) e não é afetada por `migrarSchema()`.

- Definida ao criar um cliente novo (`criarCliente`, campo "Prazo de pagamento" no formulário "Novo Cliente"). O campo aceita um número único (`90`) ou parcelado (`60/90`).
- Editável para clientes existentes na aba "Cadastrar" (campo "Prazo de pagamento" acima do formulário de referência → `salvarPrazoPagamento`), mesmo formato livre (`90` ou `60/90`).
- `getReferencias` retorna `prazoPagamento` (string bruta da célula), `prazoPagamentoDias` (primeiro número, via regex `/\d+/g`, robusto a variações como `"90"`, `"90 dias"`, `"90DIAS"`) e `prazoPagamentoDiasTodos` (array com **todos** os números da célula, ex: `[60, 90]` — usado na comparação multi-parcela).
- Na aba "Conferir", `confParseCampos` extrai o prazo do PDF:
  - DASS/RAMARIM: `Condições de pagto: 90DIAS` → regex `/Condi\S*\s+de\s+pag\S*\s*:?\s*(\d+)\s*dias/i` → um único número.
  - DILLY: tabela "Previsão" com colunas "Dias Parcela" / "Valor Parcela" na última página de cada OC — pagamento sempre em 2 parcelas iguais (50%/50% do total), tipicamente 60 e 90 dias. `confParseCampos` localiza a linha `Dias Parcela`, lê cada linha seguinte que casa `^(\d{2,3})\s*R\$` até a linha `Total`, e monta `prazoPagamento` como `"60/90"` (com fallback para o caso em que cabeçalho e valores caem na mesma linha reconstruída).
  - Em ambos os casos `c.prazoPagamento` é uma string que pode conter um ou mais números separados por `/`.
- `confRenderResultados` compara a lista de dias extraída do PDF (`campos.prazoPagamento.split("/")`) com a lista cadastrada (`item.prazoCadastradoTodos`, vindo de `prazoPagamentoDiasTodos`): listas iguais (mesmo tamanho e mesma ordem) → badge "confere"; tamanhos/valores diferentes → "divergente" (mostra ambas as listas, ex: `pedido 60/90 dias × cadastro 90 dias` — sinaliza cadastro legado ainda não migrado para o formato parcelado); só um dos dois lados tem dado → aviso de "sem cadastro" ou "não encontrado no pedido".

### Células AC1 (apelidos de conferência) e AD1 (itens ignorados) — metadados, fora do SCHEMA_CLIENTE

O fluxo de "ensinar associação" da aba Conferir (ver seção DAKOTA abaixo) persiste em **duas células de metadados** por aba de cliente, escolhidas **bem longe** das colunas de custo legadas N/O/P (que ainda têm dados em DASS/RAMARIM/DAKOTA) e das células S1/T1/U1/V1 — evitando qualquer colisão/sobrescrita:

- **AC1 — apelidos aprendidos**: mapa `CODIGO=apelido` com entradas separadas por `|` (ex.: `M1294=LS11628|M13499=cad.bicolor`). `getReferencias` lê AC1, monta `aliasMap[codigo] → [apelidos]` e anexa `aliasesConf` (string `|`-separada) a **todas as vigências** daquele código. `confValidar` transforma cada apelido num candidato-alias (mesmo mecanismo do `ant.` legado). Escrita: `salvarAliasConf(nomeAba, linhaAlvo, alias, token)` (admin) lê o código da linha escolhida e faz append em AC1.
- **AD1 — itens fora da tabela**: tokens de descrição separados por `|`. `getReferencias` retorna `ignoradosConf`; `confValidar` marca como status **`IGNORADO`** (neutro, não sinaliza) qualquer bloco não-casado cujo texto normalizado contenha um token. Escrita: `salvarIgnoradoConf(nomeAba, chave, token)` (admin).

Ambas são criadas sob demanda (`setValue`) — **não** exigem `migrarSchema()`.

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
// No backend (Codigo.gs): helper compartilhado _pN (topo do arquivo).
// Aceita número puro, vírgula decimal ("10,50"), prefixo de moeda
// ("R$ 0,89" — caso real da aba DAKOTA, colada como texto) e separador
// de milhar ("1.234,56"). As funções fazem `const pN = _pN;` localmente.
function _pN(v) {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  let s = String(v == null ? "" : v).replace(/R\$/gi, "").trim();
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  return parseFloat(s) || 0;
}

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
5. Status possíveis: `OK`, `DIVERGENTE`, `AMBIGUO`, `VENCIDO`, `SEM_PRECO`, `SEM_MEDIDA`, `NAO_CADASTRADO`.
   - **`NAO_CADASTRADO` — motivo detalhado no card** (vale para todos os clientes, atuais e futuros): quando nenhum candidato casa por completo, `confValidar` distingue dois casos no `res.motivo`/`refNome`: (a) **código-base existe, variante de medida não** — algum candidato com `rxBase` casa o bloco mas o `rxMm` não (ex.: PDF `M12021 8MM`, tabela só tem `M12021 6MM`); o card mostra o código-base, as medidas cadastradas e a medida que o pedido pede (`confMedidaPdf` pega o token `<n>MM` mais próximo do código, preterindo ponteiras distantes como `20MM`); (b) **referência inexistente** — nenhum `rxBase` casa; mensagem deixa claro que nenhum código compatível foi encontrado.

**Preço ambíguo entre variantes (status `AMBIGUO`)**: quando a mesma Referencia+MedidaBase tem mais de uma linha vigente com Descricao diferente (ex.: mesma referência/tamanho em duas cores, cada uma com seu preço — caso real `M13801` da DASS: "preto/Branco Umbro" a R$0,49 × "cores Umbro" a R$0,77, ambas 120cm) e o preço do pedido não bate com nenhuma delas, `confValidar` **não** escolhe uma das linhas por padrão (a ordem de desempate de `confEscolherVigencia` quando há empate de data é a ordem crua da planilha — arbitrária, não uma identificação real). Em vez de marcar `DIVERGENTE` contra um preço/descrição que pode nem ser do item do pedido, marca `AMBIGUO`: `res.esperado` e `res.descricao` ficam vazios (o card não mostra "Esperado" nem a descrição de uma variante específica) e `res.motivo` pede para o usuário comparar manualmente a lista de `opcoes` (preço + descrição + vigência de cada variante, já usada para o caso em que uma delas bate) com o trecho do pedido. Quando uma das opções **bate** com o preço do pedido, o comportamento não muda: essa opção vira o `esperado`/`descricao` normalmente (`OK`/`DIVERGENTE`).

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
- Extrator: `confExtrairBlocos` / Parser: `confParseItemBloco`.
- **Tamanho (cm) às vezes vem sem o sufixo "CM"** — achado real na OC `16200530` (2 de 4 itens): a linha normalmente é `Quantidade: | 120CM/93 |`, mas o ERP da DASS às vezes gera `Quantidade: | 130/863 |` (só `<tamanho>/<qtd>`, sem letra nenhuma). `confParseItemBloco` cobre os três casos (`CM`, só `C` — caso antigo de "M" sumir na extração — e ausência total) via `(?:CM?)?` opcional, ancorado em `Quantidade:` para não casar com outro `<n>/<n>` do bloco (ex.: a data `DD/MM/YYYY` da linha do item, que também tem esse formato). Sem a âncora, tornar o `C` opcional teria feito o regex casar com a data em vez do tamanho.

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

### Aba "Conferir" — formato DAKOTA (arquivos-texto, **não** PDF)

A Dakota manda os pedidos como **arquivos-texto**, não PDF. A aba Conferir aceita esses arquivos direto no `<input>`/drop-zone (`accept` inclui `.dkn,.dke,.htm,.html,.txt`). `confArquivosSelecionados` ramifica por tipo: PDF segue o caminho pdf.js; os demais são lidos com `file.text()` e roteados para os leitores DAKOTA. `confExecutarAnalise` guarda `item.blocos`/`item.formato` e chama `confValidar` com `opts` (ver abaixo). PDFs de exemplo/uso na raiz: `.dkn`/`.dke` (JHONY 1-10, oc26xx/oc260x CEARA) e `.htm` (`oc86488ddkn.htm`, `oc87333ddkn.htm`).

**Dois subformatos** (`item.formato`):
- **`DAKOTA_FIXO`** (`.dkn`/`.dke`) — largura fixa, **uma linha = um item**. `confDakotaLerFixo` filtra as linhas de item (contêm `Arquivo XML` + `(PR|MT)\d{17}R$`); a própria linha crua é o "bloco" (a descrição `ATACADOR/FITA … <código> …` está nela, então `confRefRegex` casa direto). `confParseItemBlocoDakotaFixo` extrai: unidade `PR`/`MT`, preço (`\d{17}` após a unidade, **÷100** = centavos implícitos), qtd (`\d{9}` antes, ÷1000), tamanho `NNcm` e largura `mm` (ignorando a ponteira `PONT.20MM`).
- **`DAKOTA_HTM`** (`.htm`) — "Ordem de Compra" em HTML. `confDakotaLerHtm` extrai cabeçalho do texto sem tags e os itens percorrendo `<tr>` com 7 células (a **descrição** é a célula com `font size=1`; qtd/uni/prc são as 3 células seguintes). Números do htm usam **ponto decimal** (`0.67`) → `confPUS` (não `pBR`, que trata `.` como milhar). Cada item vira um bloco `"<descrição>  ###U:<uni> ###P:<preço> ###Q:<qtd>"`; `confParseItemBlocoDakotaHtm` lê os marcadores `###` e a descrição (onde `confRefRegex` casa). Ao exibir "Ver trecho do pedido"/descrição do card, os marcadores `###…` são removidos.

**Modalidade origem→destino (RS/RS · RS/CE · CE/CE) por CNPJ** — o ponto central deste cliente:
- **Fornecedor Marfim** (origem): `93825230000170` = **RS** · `19542918000190` = **CE** (`CONF_MARFIM_CNPJ` — compartilhado com a ANIGER, é o CNPJ da própria Marfim).
- **Comprador Dakota** (destino): CNPJ começa com `07414643` = **RS** · `00465813` (Dakota Nordeste, Russas/Maranguape) = **CE** (`confDakotaDestino`).
- `confModalidadeDuplo(origem,destino)`: CE→CE=`CE/CE` · RS→RS=`RS/RS` · RS→CE=`RS/CE`. **CE→RS não ocorre** (Marfim-CE só vende p/ CE).
- Como a DAKOTA é **preço duplo**, as colunas I/J/K já são RS/CE·RS/RS·CE/CE. `confModalUf` mapeia a modalidade para o **código de coluna** usado por `confValidar` (`precoRS`/`precoBA`/`precoCE`): **RS/CE→`RS`** · **RS/RS→`BA`** · **CE/CE→`CE`**. No fixo os CNPJs saem das posições da linha; no htm, do bloco fornecedor + município do comprador. O seletor do card mostra a **modalidade** (valores = códigos de coluna), permitindo corrigir manualmente.

**`confValidar` ganhou um 6º parâmetro `opts`** (retrocompatível — DASS/RAMARIM/DILLY chamam sem ele):
- **`opts.arred`** — arredondamento do proporcional em centavos. A Dakota usa a **regra padrão** (`confArredCentPadrao`, mesma de `confCentavos`): 3ª casa decimal 0-4 mantém, 5-9 sobe (`0,984→0,98`; `0,985→0,99`). Sem isso o `esperado` ficaria sem arredondar (valor bruto), embora a comparação com o pedido já aplicasse a mesma regra via `confCentavos` — `arred` existe para o valor **exibido** no card bater com o usado na comparação.
- **`opts.ignorados`** — lista de AD1 (itens fora da tabela → status `IGNORADO`).
- **Filtro por tipo de unidade**: quando o item traz `unit` (`PR`/`MT` — só formatos Dakota), `confValidar` prefere as linhas do **mesmo tipo** (PR→PAR/cm, MT→METRO/direto) antes de `confEscolherVigencia`. Corrige o caso `M22063` (linha PAR e linha METRO de mesma `DataInicio` — o desempate por data cairia na errada). DASS/RAMARIM/DILLY não setam `unit` → filtro inócuo.
- **Preço atual**: `confExecutarAnalise` chama a Dakota com `emissao=""` → `confEscolherVigencia` usa a data de hoje = **vigência mais recente** (decisão do usuário: conferir contra o preço atual, não o vigente na data do pedido).

**Fluxo "ensinar associação"** (item não identificado) — **à parte** da "Comunicar a direção" (que pede cadastro de item/preço e continua igual):
- **Admin (`*`)**: botão **"🎓 Identificar / ensinar"** abre painel inline (`confEnsinarPanel`) — escolhe a referência da tabela (lista de `item.refsCadastro`, guardada na análise), edita o **apelido sugerido** (`confAliasSugerido` limpa categoria/tamanho/cor) e salva (`confSalvarAlias` → `salvarAliasConf` grava `CODIGO=apelido` em **AC1**). Botão **"Não está na lista de preços"** → `confMarcarIgnorado` → `salvarIgnoradoConf` grava em **AD1** (status `IGNORADO`). Após salvar, re-roda `confExecutarAnalise` (sem cache) e o item já casa.
- **Vendedor (não-admin)**: botão **"📤 Enviar item para análise"** → `confEnviarAnalise` → backend `enviarItemAnalise` manda email aos admins **com o arquivo do pedido anexado** (`dados.mime` correto por extensão — `confMimeArquivo`) para o admin abrir, testar e ensinar.
- Novo status **`IGNORADO`** em `CONF_STATUS` (peso 6, neutro) e no resumo.

### Aba "Conferir" — formato ANIGER/MELBROS (PDF do ERP do cliente) — **formato preferido**

Desde 2026-08 o cliente passou a mandar as OCs em **PDF**, que é o formato a usar (o leitor `.edi` da seção seguinte continua funcionando, mas o PDF traz muito mais informação). Amostras na raiz: `OC_ANIGER_20109721.pdf`, `OC_ANIGER_20116455.pdf`, `OC_ANIGER_80144715.pdf`, `OC_MELBROS_60001709.pdf`.

**O grupo compra com duas razões sociais** na mesma ordem de compra: **ANIGER** (Quixeramobim/**CE**) e **MELBROS** (Campo Bom/**RS**). São o **mesmo cliente comercial** — as duas usam a tabela da aba `ANIGER CLIENTE`; o que muda é só o **destino**, que define a modalidade junto com a filial Marfim de origem. Como o texto de "condições gerais" cita as duas razões sociais nos pedidos das duas, a identificação é feita pelo **CNPJ do topo do pedido** (`CONF_ANIGER_COMPRADOR`, chaveado pela raiz de 8 dígitos → `{uf, cliente}`: `94316999` → CE/ANIGER · `11366487` → RS/ANIGER) e **ganha da busca por nome no texto** (`campos.clienteHint` tem precedência em `confArquivosSelecionados`; sem CNPJ conhecido o card fica sem cliente para o usuário escolher, em vez de conferir contra a tabela errada).

- **Detecção do layout**: `confIsAnigerPdf(linhas)` — cabeçalho da tabela `Material Descrição Modelo Programa` + `Cond. pagto:` (marcadores do ERP, não o nome do cliente). Ordem em `confParseCampos`/`confExecutarAnalise`: RAMARIM → DILLY → **ANIGER/MELBROS** → DASS (default).
- **Cabeçalho**: nº da OC e CNPJ do comprador saem da **mesma linha** do topo (`94.316.999/0009-83 20109721`); emissão (`Emissão: DD/MM/YYYY`); prazo (`Cond. pagto: 45 DD` → **45 dias**); marca da linha `Fábrica: 1051 - Nike NE - Produção Aniger` → `Nike NE` (validado também com `ASICS` e `Petite Jolie Amostras`).
- **Modalidade origem→destino**: origem = CNPJ da filial Marfim no bloco do fornecedor; destino = CNPJ do comprador, com o **CEP do bloco do comprador** como reserva para filial ainda não mapeada (9xxxx = RS · 60000-63999 = CE). Nas amostras: `CE→CE` (2), `RS→CE` (1) e `RS→RS` (1, pedido da Melbros — mesma tabela ANIGER, coluna RS/RS).
- **Atenção — CNPJ Marfim novo**: os pedidos ANIGER/MELBROS trazem `12.954.695/0001-20` ("Marfim Textil RS Ltda"), que **não existia** em `CONF_MARFIM_CNPJ` (só havia `93825230000170` para o RS, dos pedidos DAKOTA). Sem ele a origem não era identificada e a modalidade saía vazia. Ao aparecer uma filial/razão social nova da Marfim, incluir na constante.
- **Itens** — `confExtrairBlocosAnigerPdf` / `confParseItemBlocoAnigerPdf`. Cada item ocupa ~3 linhas e o bloco junta todas (`\n`):
  ```
  29079122563 ATACADOR POLIE REC 1.532,0000PR R$ 0,8900 0 0 1.363,48 25/11/2025
  MR140.019 CHATO 6MM 100CM
  PHANTOM 5820
  ```
  A linha-âncora tem código do material + qtd/unidade + preço (a qtd pode vir **colada** na unidade: `1.532,0000PR`). A tabela começa no cabeçalho `Material Descrição Modelo` e termina em `N Itens Totais` / `Programas:` / `CONDIÇÕES GERAIS`.
- **O PDF resolve o que o `.edi` não tinha**: traz o **tamanho** (`100CM`), a **espessura** (`6MM`) e, na coluna *Modelo*, a **própria referência Marfim** (`M2173`, `M41552`, `MR140.019`) — o casamento normal do `confRefRegex` funciona **sem precisar ensinar apelido**, e o `rxMm` discrimina 6MM × 8MM. Ponto verificado: `MR140.019` do PDF casa com `MR140019` cadastrado (o regex tolera `.` entre os caracteres).
- **Unidades**: `PR`/`PC` → par (proporcional por cm); `M`/`MT`/`KG` → preço direto. Achado real das amostras: o atacador é cobrado **exatamente proporcional** a uma base de 100cm — CE/CE 0,89 → 95cm = 0,85 e 105cm = 0,93, batendo em centavos pela regra de arredondamento padrão.
- **Vigência**: como nos demais formatos deste cliente, a conferência é contra o **preço atual** (emissão vazia em `confExecutarAnalise`), não contra a vigência da data do pedido.
- **Tabela real disponível** (`tabela de preços - ANIGER CLIENTE.csv`, subida em 2026-09) — o harness passou a validar contra ela em vez de uma tabela sintética. Achado real confirmado com os 4 PDFs de amostra: `M2173` e `M41552` **não têm preço cadastrado na coluna RS/RS** (só RS/CE e CE/CE preenchidas) — o pedido real da Melbros (`OC_MELBROS_60001709`, modalidade RS/RS) cobra R$2,18 por `M41552` e cai em `SEM_PRECO`, não porque o parser falhou em achar a referência, mas porque a coluna realmente está vazia/zero na planilha. **Não é bug** — é lacuna de cadastro; o valor do próprio pedido real (R$2,18) é um bom candidato a cadastrar na coluna RS/RS caso seja esse o preço praticado.
- **Rótulo de UF nas mensagens de preço ausente**: como os clientes preço duplo reaproveitam as colunas RS/BA/CE internamente com papel trocado, `confValidar` mostrava o código bruto da coluna ("sem preço BA") em vez do rótulo real ("sem preço RS/RS") — confuso, já que a ANIGER nem vende pra Bahia. Corrigido via `confRotuloUf(uf,duplo)` + `opts.duplo` (setado a partir de `item.precoDuplo`) nas chamadas de `confValidar` para DAKOTA/ANIGER.

### Aba "Conferir" — formato ANIGER (arquivo-texto `.edi`)

**Formato anterior, mantido em funcionamento** (o cliente migrou para o PDF da seção acima). A Aniger mandava os pedidos como arquivos-texto `.edi` de largura fixa — mesma **família** EDI do `.dkn` da Dakota, mas layout diferente o bastante para exigir leitor próprio (`confAnigerEhEdi` / `confAnigerLerEdi` / `confAnigerBlocoDaLinha` / `confParseItemBlocoAnigerEdi`; `item.formato = "ANIGER_EDI"`). Amostras na raiz: `20117805__CEARA.edi`, `20118265__CEARA.edi`, `20118349__CEARA.edi`, `20118480__CEARA.edi`, `80163303__CEARA.edi` (27 itens no total).

**Uma linha = um item** (~3075 posições). Diferenças em relação ao `.dkn` da Dakota:

| | DAKOTA `.dkn` | ANIGER `.edi` |
|---|---|---|
| marcador da linha de item | `Arquivo XML` + `(PR\|MT)\s\d{17}R$` | `OCgerada a partir da OC <n>` + `\d{9}[A-Z]{1,2}\s{1,2}\d{17}R$` |
| unidade | `PR` / `MT` | `P` solto (+ 2 espaços) |
| preço empacotado | 2 casas (`...075` = 0,75) | **4 casas** (`...9300` = 0,9300) |
| referência Marfim | vem na descrição (`ATACADOR 100 CM M16214 6MM ...`) | **não vem** — descrição genérica (`ATACADOR POLIE REC`) |
| tamanho (cm) | na descrição | **não vem** |

- **Cabeçalho** (todas as linhas do arquivo repetem; sai da primeira): nº da OC (`OCgerada a partir da OC <n>`, com fallback nas posições 15-22), emissão (`\s(\d{8})V\d`), prazo (3 dígitos de largura fixa logo após `R$` — `045` = **45 dias**, mesmo campo do `.dkn`), CNPJ do comprador (posições 1-14) e do fornecedor Marfim (14 dígitos antes do código do item, no fim da linha).
- **Modalidade origem→destino**: `CONF_MARFIM_CNPJ` (fornecedor, compartilhado com a Dakota) + `CONF_ANIGER_COMPRADOR` (`94316999000983` = **CE**) → `confModalidadeDuplo` → `confModalUf` decide a coluna de preço. Nas amostras: Marfim CE → Aniger CE = **CE/CE** (coluna K). Quando os CNPJs não resolvem a modalidade, o card exibe aviso e o seletor permite corrigir à mão.
- **Identificação do item — o ponto central deste cliente**: o pedido traz só o **código interno da Aniger**, 11 dígitos = **6 de produto + 5 de cor** (nas amostras o preço varia apenas com os 6 primeiros: `290791` = 0,89 · `294433` = 0,85 · `294434` = 0,93). O bloco montado por `confAnigerBlocoDaLinha` carrega `COD <11 dígitos>` e `PROD <6 dígitos>` além da descrição, para o `confRefRegex` casar os **apelidos aprendidos** (célula AC1). `confAliasSugerido` sugere o código de **produto** (vale para todas as cores); o admin troca pelo `COD` completo se aquela cor tiver preço próprio. **Sem ensinar a associação, todo item cai em `NAO_CADASTRADO`** — é o fluxo esperado, não um bug.
- **Preço**: o campo empacotado (÷10000) é conferido contra o valor impresso na própria descrição (`R$ 0,9300`), que prevalece quando presente — nas 27 amostras os dois batem 100%.
- **Sem tamanho no pedido → preço direto**: `confParseItemBlocoAnigerEdi` devolve `semTamanho: true` e `confValidar`/`confPrecoEsperado` comparam o preço do pedido **direto** com o preço cadastrado na linha casada, em vez de marcar `SEM_MEDIDA` (o tamanho fica implícito na associação código → referência). O card mostra `"<base>cm · pedido sem tamanho (preco direto do cadastro)"`.
- **Detecção do cliente**: o `.edi` não traz o nome "ANIGER" em lugar nenhum. Os leitores de arquivo-texto informam `campos.clienteHint` (`"ANIGER"` / `"DAKOTA"`) e `confArquivosSelecionados` seleciona a aba correspondente quando a detecção por texto não acha nada.

**Validação (harness):** `amostras/harness.js` reproduz as funções puras (ainda sem o status `AMBIGUO` abaixo — desatualizado nesse ponto) e `amostras/verifica_index.js` carrega o `<script>` real do `Index.html` num sandbox e roda ambos contra os 23 arquivos → **52 OK · 56 DIVERGENTE · 9 AMBIGUO · 6 NÃO_CADASTRADO · 1 SEM_PREÇO** (as divergências são reais/reajuste: M13499 1,27×1,26; M22063 reajustado em 08/07; MER cobrado na coluna RS/RS; M16214 120cm preto/cinza; M16214 110cm cobrado 1 centavo abaixo do proporcional exato — 110/100×0,75=0,825, arredonda para 0,83 pela regra padrão; LS16410 c/ desconto). Os 9 `AMBIGUO` são referências com >1 preço vigente para a mesma Referencia+MedidaBase (variantes de descrição, ex.: cor) cujo preço do pedido não bate com nenhuma delas — ver seção "Preço ambíguo entre variantes (status AMBIGUO)" abaixo. Ensinar `LS11628→M1294` + ignorar `FITA REFORCO FR` zera os 6 não-cadastrados (3→OK, 3→IGNORADO). Rodar: `node amostras/verifica_index.js` (precisa dos 23 arquivos e da CSV DAKOTA no lugar). O mesmo script valida ainda a **extração ANIGER** dos 5 `.edi` (27 itens, modalidade CE/CE, prazo 45, preço empacotado × preço impresso, apelido sugerido = código de produto) e uma **conferência ponta a ponta com tabela sintética** (a aba ANIGER ainda não tem itens): apelido → linha → preço direto, esperando 15 OK · 12 DIVERGENTE. Para o **PDF ANIGER/MELBROS** o harness roda sobre `amostras/aniger_pdf_linhas.json` — as linhas já extraídas pelo mesmo `confExtrairLinhas`, para não exigir pdf.js instalado — conferindo cabeçalho, modalidade, cliente, nº de itens e a conferência contra a tabela **real** (`tabela de preços - ANIGER CLIENTE.csv`) → **4 OK · 1 DIVERGENTE · 1 SEM_PREÇO** (ver achados reais na seção "formato ANIGER/MELBROS" acima — `M2173` e `M41552` sem preço RS/RS cadastrado). Regenerar a fixture quando chegarem amostras novas.

### Aba "Conferir" — formato BEIRA-RIO (PDF do ERP próprio)

Cliente adicionado em 2026-09. Formato **modelo por estado** (padrão, não é preço duplo). PDFs de exemplo na raiz: `OrdemCompra6ee4564329e847029cbce391560cc9a7_8281.pdf` (1 pág., 5 itens), `OrdemComprad8d168b405ee41e699d336105716860d_8281.pdf` (6 pág., 51 itens). Único cliente até agora cujo layout é uma **grade de caixas** (não texto corrido) — a ordem do texto no stream do PDF sai embaralhada (label/valor fora de ordem), mas `confExtrairLinhas` (reconstrução por coordenada Y/X, já usada para DASS em paisagem) resolve isso: cada item vira um bloco **fixo de 7 linhas**, confirmado por extração real via pdf.js (`amostras/beira_rio_pdf_linhas.json`):
```
Código <cod> - <descricao...> Nomenclatura
Cor <cod> -<nome>
Quantidade Total Unidade Medida Preço % IPI Data Entrega Remessa Valor Total
<qtdTotal> <M|PAR> <preço>,dddd <ipi>,dd <data> [<valorTotal>,dddd]
Tamanho <0|1|2>
Quantidade <n>
Sequência <n>
```
- **Detecção**: `confIsBeiraRio` — cabeçalho `CALCADOS BEIRA RIO`. Ordem em `confParseCampos`/`confExecutarAnalise`: RAMARIM → DILLY → ANIGER/MELBROS → **BEIRA_RIO** → DASS (default).
- **Cabeçalho**: nº OC (`Número OC: <n>`), emissão (`DATA DE EMISSÃO: DD/MM/YYYY`), UF = filial Marfim fornecedora (mesmo padrão `MARFIM.../UF` do DASS/RAMARIM — nas amostras sempre `MARFIM TEXTIL RS LTDA` / `CAMPO BOM/RS` → RS). **Prazo de pagamento**: `COND. PAGTO: 007` é um código numérico de largura fixa do ERP da Beira Rio — **calibrado contra o cadastro real** (célula S1 = `"7 dias"`): o código É o próprio número de dias com zeros à esquerda (`007` → `7`), mesmo padrão já usado no campo de prazo do `.dkn`/`.edi` (3 dígitos fixos após `R$`). Extraído via `parseInt`, sem a exigência de sufixo `"dias"` (diferente da RAMARIM).
- **Referência Marfim**: embutida na descrição do `Código` como `REF.<código>` ou `REF <código>` (sem separador fixo) — o `confRefRegex` já casa isso sem ajuste (o `.`/espaço entre `REF` e o código já é tolerado pelo `[^A-Z0-9]` da âncora). **Atenção**: nem toda descrição usa o código Marfim cadastrado — `174711 - GORGURAO REF.MFGP 7MM` não casa com nada por padrão (a referência real é `M41565`, mesma espessura 7MM e mesmo preço 0,68 — confirmado no cadastro), e cai em `NAO_CADASTRADO` até o admin ensinar o apelido `MFGP→M41565` pelo fluxo padrão (célula AC1). **Não é bug** — é o mesmo caso já coberto pelo mecanismo de "ensinar associação" usado em RAMARIM/ANIGER.
- **Tamanho**: o campo `Tamanho` do bloco (`0`/`1`/`2`) diz qual medida usar — `0` = item vendido por metro, mm direto da descrição (ex.: `M21189 10MM`), preço direto sem cálculo; `1`/`2` = par, cm embutido na mesma descrição em um de dois formatos vistos: `T1-NN A MM =CMcm` (elásticos, ex. `T1-33 A 36 =70CM / T2- 37 A 40=80CM`) ou `TAM.1(NNaMM)CMcm` (atacadores, ex. `TAM.1(37AO40)120CM / TAM.2 (41AO44)130CM BRS`) — `confParseItemBlocoBeiraRio` cobre os dois. Ao extrair mm (Tamanho 0), ignora a ponteira (`C/PONTEIRA 15MM`) — mesmo cuidado já usado na ANIGER.
- **Caso raro — duas remessas, preço único**: quando T1 e T2 do mesmo item saem com o **mesmo preço**, o pedido junta as duas remessas numa única linha de dados com `Tamanho 1 2` (ex.: Código 206250, 35cm+40cm a 0,53). Em vez de adivinhar qual medida usar, `confExtrairBlocosBeiraRio` gera **um bloco por tamanho**, cada um conferido contra o cadastro independentemente.
- **Cálculo**: par usa o proporcional padrão `(cm/MedidaBase)×PrecoUF` a partir de uma única linha cadastrada por referência (ex.: `M21192` cadastrado só a 100cm/R$1,18 cobre T1/T2 de vários "Código" diferentes por proporção — `M6034` a 100cm/R$1,08 idem); metro usa preço direto.
- **Validação (harness):** `amostras/verifica_index.js` roda sobre `amostras/beira_rio_pdf_linhas.json` (linhas já extraídas, mesmo truque do fixture ANIGER) contra a tabela **real** (`tabela de preços - BEIRA-RIO CLIENTE.csv`, não sintética — a aba já tem cadastro) → **47 OK · 6 DIVERGENTE · 3 NÃO_CADASTRADO**. Achados confirmados, não bugs de parser: os 3 NÃO_CADASTRADO são o caso `MFGP` acima; as 6 divergências são (a) 4× o Código `187807` (elástico M21192, T2=60cm) cobrando R$0,79 quando o proporcional a partir do cadastro dá R$0,71 — mesma medida (60cm) bate certinho em outros "Código" do pedido (`188654`, `206756`), então é um preço específico desse item que vale a pena confirmar com o cliente; (b) 2× o Código `206250` (caso de remessa dupla acima, 35cm/40cm a R$0,53 — não bate com nenhuma das duas medidas calculadas a partir do cadastro, R$0,41/R$0,47). A tabela da CSV é apenas um snapshot para calibração — a conferência em produção lê a aba `BEIRA-RIO CLIENTE` ao vivo.

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
