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
| G      | Unidade      | String  | Sim (`metros` / `pares` / `pecas`) |
| H      | MedidaBase   | Number  | Sim (mm para metros, cm para pares/peças) |
| I      | PrecoRS      | Number  | Não (usa Preco base se vazio/zero) |
| J      | PrecoBA      | Number  | Não (usa Preco base se vazio/zero) |
| K      | PrecoCE      | Number  | Não (usa Preco base se vazio/zero) |
| L      | PrecoMG      | Number  | Não (usa Preco base se vazio/zero) |
| M      | Peso         | Number  | Não (peso do material, ex: g/m) |

Itens sem Unidade/MedidaBase (legados) são tratados como `metros` com cálculo direto `preco × entrada`.
Preços por estado são opcionais; quando zero/ausentes, o frontend usa o Preco base.

---

## Lógica da calculadora

Fórmula proporcional: `(entrada / MedidaBase) × Preco`

- **metros**: entrada = nova largura em mm; base = largura cadastrada em mm
- **pares / peças**: entrada = novo tamanho em cm; base = tamanho cadastrado em cm

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

A aba Conferir do `Index.html` lê uma ordem de compra em PDF inteiramente no navegador (pdf.js via CDN — nenhuma função nova de backend):

1. `confExtrairLinhas` reconstrói as linhas visuais por coordenada — usa `pdfjsLib.Util.transform` com o viewport da página, obrigatório para PDFs em paisagem/rotacionados (caso das OCs da DASS).
2. `confParseCampos` detecta nº da OC, marca, data de emissão e UF da tabela (`/CE`, `/BA` etc. próximo de "MARFIM" no bloco do fornecedor). O cliente é detectado comparando o texto com os nomes das abas de cliente.
3. `confExtrairBlocos` divide o texto em blocos de item delimitados pela linha `Quantidade:`. `confParseItemBloco` extrai o tamanho (`65CM/288` → cm), a quantidade e o preço unitário (preferência: `Vlr. total ÷ Qtde total`; fallback: valor logo após a data de Prev. Ent.).
4. `confValidar` casa cada bloco com as referências do cliente e compara com a linha da tabela cuja vigência cobre a data de emissão. **Cálculo por tipo de produto**: pares/peças são vendidos por tamanho → `esperado = (tamanho_cm ÷ MedidaBase) × preço da UF` (ex.: base 100cm a R$ 1,95 → 65cm = R$ 1,27); metros têm preço direto por metro, **sem cálculo**. O rótulo da MedidaBase (`"100 CM"`, `"10mm"`) tem prioridade sobre o campo Unidade para decidir o tipo (corrige cadastros legados). Tolerância `CONF_TOLERANCIA` (±R$ 0,01) absorve o arredondamento de 2 casas do ERP do cliente. Regras de casamento (`confRefRegex`):
   - A referência é identificada pelo **início do código**: a descrição embutida entre parênteses no cadastro é ignorada (`M21048(elást.red.2,5mm tranç.16f.)` → casa por `M21048`), e `M2173` casa com `M2173.114` e `M2173 BRANCO`, mas **não** com `M21730` (dígito a mais = outro código).
   - Separadores espaço/ponto/barra/hífen são tolerados dentro do código (`MR110022` ↔ `MR 110022`, `MFGP/T2` ↔ `MFGPT2`).
   - **Atributo goma** (`confTemGoma`/`confBaseRef`): variantes com/sem goma do mesmo código são candidatas distintas. O PDF pode indicar goma como `C/GOMA`, `engomada`, `engomado`, `egomada`, `engo`, `gomada`; negações (`S/GOMA`, `sem goma`) contam como sem goma. O atributo pode estar na referência cadastrada (ex.: `MFGP/T2 C/Goma`) ou só na Descricao. Empate de código é decidido pela variante cujo atributo coincide com o pedido; se divergir, um aviso é exibido no resultado.
5. Status possíveis: `OK`, `DIVERGENTE`, `VENCIDO`, `SEM_PRECO`, `SEM_MEDIDA`, `NAO_CADASTRADO`.

O parsing foi calibrado com as OCs da DASS (PDFs de exemplo na raiz do repositório). Outros clientes com layout diferente podem exigir ajuste em `confExtrairBlocos`/`confParseItemBloco`.

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
