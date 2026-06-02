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

Itens sem Unidade/MedidaBase (legados) são tratados como `metros` com cálculo direto `preco × entrada`.

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
