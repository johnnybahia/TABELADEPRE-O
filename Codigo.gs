// ============================================================
// TABELA DE PREÇOS MARFIM — Google Apps Script Backend
// ============================================================

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const SUFIXO_CLIENTE = " CLIENTE";
const ABA_VENDEDORES = "VENDEDORES";
const ABA_LOG = "LOG";

// Colunas VENDEDORES: A=ID B=Nome C=Senha D=Clientes (separados por | ) E=Email

// ============================================================
// SCHEMA DAS ABAS DE CLIENTE
// Ao adicionar uma nova coluna: inclua aqui e rode setup() ou migrarSchema().
// A ordem define a posição das colunas. Nunca reordene entradas existentes.
// ============================================================
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
  // → próximas colunas aqui
];

// ============================================================
// PONTO DE ENTRADA WEB
// ============================================================
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("Tabela de Preços")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// SESSÃO — token de sessão por login, validado em todas as
// funções de backend (em vez de confiar no vendedorId enviado
// pelo cliente). Permissões (admin/clientes) são sempre
// reconsultadas em tempo real na aba VENDEDORES a partir do
// vendedorId resolvido pelo token, nunca cacheadas no token —
// revogar acesso na planilha tem efeito imediato.
// ============================================================
const SESSAO_TTL_SEGUNDOS = 6 * 60 * 60; // 6h — máximo permitido pelo CacheService

function _criarSessao(vendedorId) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put("sessao_" + token, String(vendedorId), SESSAO_TTL_SEGUNDOS);
  return token;
}

function _validarSessao(token) {
  if (!token) return null;
  return CacheService.getScriptCache().get("sessao_" + token) || null;
}

// Resolve um token para o vendedorId real; lança erro padronizado se inválido/expirado.
function _exigirSessao(token) {
  const vendedorId = _validarSessao(token);
  if (!vendedorId) throw new Error("SESSAO_EXPIRADA");
  return vendedorId;
}

function _buscarVendedor(vendedorId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName(ABA_VENDEDORES);
  if (!aba) return null;
  const dados = aba.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][0]).trim() !== String(vendedorId).trim()) continue;
    return {
      id: String(dados[i][0]),
      nome: String(dados[i][1] || ""),
      clientes: String(dados[i][3] || "").split("|").map(c => c.trim()).filter(Boolean)
    };
  }
  return null;
}

// ============================================================
// AUTENTICAÇÃO
// ============================================================
// Trava contra tentativa e erro (brute force): após LOGIN_MAX_TENTATIVAS
// senhas erradas para o MESMO código de vendedor, aquele código fica
// bloqueado por LOGIN_BLOQUEIO_SEGUNDOS. O contador vive no CacheService
// (some sozinho após o período de bloqueio, sem inatividade) e é keyed
// pelo ID digitado — assim um ataque só bloqueia o próprio ID alvo, nunca
// derruba o login dos outros vendedores. Um login correto zera o contador.
const LOGIN_MAX_TENTATIVAS = 5;
const LOGIN_BLOQUEIO_SEGUNDOS = 15 * 60; // 15 min

function _chaveTentativas(id) {
  return "login_fail_" + String(id || "").trim().toUpperCase();
}

function login(id, senha) {
  try {
    const cache = CacheService.getScriptCache();
    const chave = _chaveTentativas(id);
    const raw = cache.get(chave);
    const estado = raw ? JSON.parse(raw) : { tentativas: 0, bloqueadoAte: 0 };
    const agora = Date.now();

    // Já bloqueado? Rejeita sem sequer checar a senha.
    if (estado.bloqueadoAte && agora < estado.bloqueadoAte) {
      const min = Math.max(1, Math.ceil((estado.bloqueadoAte - agora) / 60000));
      return { ok: false, erro: `Muitas tentativas. Tente novamente em ${min} min.`, bloqueado: true };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(ABA_VENDEDORES);
    if (!aba) return { ok: false, erro: "Aba VENDEDORES não encontrada." };

    const dados = aba.getDataRange().getValues();
    for (let i = 1; i < dados.length; i++) {
      const [vid, nome, vsenha, clientes] = dados[i];
      if (String(vid).trim() === String(id).trim() &&
          String(vsenha).trim() === String(senha).trim()) {
        cache.remove(chave); // login correto → zera a trava
        const clientesPermitidos = String(clientes).split("|").map(c => c.trim()).filter(Boolean);
        const token = _criarSessao(vid);
        _log(nome, "LOGIN", "");
        return { ok: true, token, vendedor: { id: vid, nome, clientes: clientesPermitidos } };
      }
    }

    // Credencial errada → conta a tentativa e, se estourar o limite, bloqueia.
    estado.tentativas = (estado.tentativas || 0) + 1;
    let msg;
    if (estado.tentativas >= LOGIN_MAX_TENTATIVAS) {
      estado.bloqueadoAte = agora + LOGIN_BLOQUEIO_SEGUNDOS * 1000;
      estado.tentativas = 0; // zera o contador; agora vale o bloqueio
      msg = `Muitas tentativas. Acesso bloqueado por ${Math.round(LOGIN_BLOQUEIO_SEGUNDOS / 60)} min.`;
      _log(String(id || "").trim(), "LOGIN_BLOQUEADO", `${LOGIN_MAX_TENTATIVAS} tentativas`);
    } else {
      const restantes = LOGIN_MAX_TENTATIVAS - estado.tentativas;
      msg = `Credenciais inválidas. ${restantes} tentativa(s) restante(s) antes do bloqueio.`;
    }
    cache.put(chave, JSON.stringify(estado), LOGIN_BLOQUEIO_SEGUNDOS);
    return { ok: false, erro: msg };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// LISTAR CLIENTES DISPONÍVEIS PARA O VENDEDOR
// ============================================================
function getClientes(token) {
  try {
    const vendedorId = _exigirSessao(token);
    const vendedor = _buscarVendedor(vendedorId);
    if (!vendedor) return { ok: false, erro: "Vendedor não encontrado." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const todasAbas = ss.getSheets().map(s => s.getName());
    const abasCliente = todasAbas.filter(n => n.toUpperCase().endsWith(SUFIXO_CLIENTE));

    const clientesPermitidos = vendedor.clientes;
    if (!clientesPermitidos || clientesPermitidos.length === 0) return { ok: true, clientes: [] };

    // Se lista contém "*", libera todos
    const liberaTudo = clientesPermitidos.includes("*");

    const resultado = abasCliente.filter(nome => {
      if (liberaTudo) return true;
      return clientesPermitidos.some(p => p.toUpperCase() === nome.toUpperCase());
    });

    return { ok: true, clientes: resultado };
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// BUSCAR REFERÊNCIAS POR CLIENTE (com filtro de busca e vigência)
// ============================================================
function getReferencias(nomeAba, busca, token) {
  try {
    const vendedorId = _exigirSessao(token);
    return _getReferencias(nomeAba, busca, vendedorId);
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// Versão interna, usada por getReferencias (já validada via token) e por
// chamadas internas do próprio backend (ex.: enviarEmailAtualizacao) que já
// têm um vendedorId resolvido e confiável.
function _getReferencias(nomeAba, busca, vendedorId) {
  try {
    if (!_validarAcesso(vendedorId, nomeAba)) return { ok: false, erro: "Acesso não autorizado." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(nomeAba);
    if (!aba) return { ok: false, erro: "Cliente não encontrado." };

    const dados = aba.getDataRange().getValues();
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const pN = v => parseFloat(String(v || "0").replace(",", ".")) || 0;
    const resultado = [];
    for (let i = 1; i < dados.length; i++) {
      const [ref, descricao, preco, dataInicio, dataFim, obs, unidade, medidaBase, precoRS, precoBA, precoCE, precoMG, peso] = dados[i];
      if (!ref) continue;

      const refStr = String(ref).toUpperCase();
      const buscaStr = String(busca || "").toUpperCase().trim();
      if (buscaStr && !refStr.includes(buscaStr)) continue;

      // Validar vigência
      const inicio = dataInicio ? new Date(dataInicio) : null;
      const fim = dataFim ? new Date(dataFim) : null;
      if (inicio) inicio.setHours(0, 0, 0, 0);
      if (fim) fim.setHours(0, 0, 0, 0);

      const vigenteInicio = !inicio || hoje >= inicio;
      const vigenteFim = !fim || hoje <= fim;
      const vigente = vigenteInicio && vigenteFim;

      resultado.push({
        linha: i + 1,
        ref: String(ref),
        descricao: String(descricao || ""),
        preco: pN(preco),
        dataInicio: dataInicio ? Utilities.formatDate(new Date(dataInicio), Session.getScriptTimeZone(), "dd/MM/yyyy") : "",
        dataFim: dataFim ? Utilities.formatDate(new Date(dataFim), Session.getScriptTimeZone(), "dd/MM/yyyy") : "Sem vencimento",
        obs: String(obs || ""),
        unidade: String(unidade || "metros"),
        medidaBase: pN(medidaBase),
        medidaBaseLabel: String(medidaBase || "").trim(),
        precoRS: pN(precoRS),
        precoBA: pN(precoBA),
        precoCE: pN(precoCE),
        precoMG: pN(precoMG),
        peso: pN(peso),
        vigente
      });
    }

    // Prazo de pagamento do cliente (célula S1, fora do SCHEMA_CLIENTE).
    // Formato simples "90 dias" (DASS/RAMARIM) ou parcelado "60/90 dias"
    // (DILLY, pagamento em parcelas) — extrai todos os números da célula.
    const prazoRaw = String(aba.getRange("S1").getValue() || "").trim();
    const prazoPagamentoDiasTodos = (prazoRaw.match(/\d+/g) || []).map(Number);
    const prazoPagamentoDias = prazoPagamentoDiasTodos.length ? prazoPagamentoDiasTodos[0] : 0;

    // Descontos/acréscimos por estado em % (células T1/U1/V1, fora do SCHEMA_CLIENTE)
    // Positivo = acréscimo, negativo = desconto. Zero/vazio = sem auto-preenchimento.
    const [dBA, dCE, dMG] = aba.getRange("T1:V1").getValues()[0];
    const descontoBA = pN(dBA);
    const descontoCE = pN(dCE);
    const descontoMG = pN(dMG);

    return { ok: true, refs: resultado, prazoPagamento: prazoRaw, prazoPagamentoDias, prazoPagamentoDiasTodos, descontoBA, descontoCE, descontoMG };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// SALVAR PRAZO DE PAGAMENTO (célula S1 da aba do cliente)
// ============================================================
function salvarPrazoPagamento(nomeAba, prazo, token) {
  try {
    const vendedorId = _exigirSessao(token);
    if (!_validarAcesso(vendedorId, nomeAba)) return { ok: false, erro: "Acesso não autorizado." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(nomeAba);
    if (!aba) return { ok: false, erro: "Cliente não encontrado." };

    // Aceita um número único ("90") ou parcelado ("60/90", pagamento DILLY em
    // parcelas) — extrai todos os números informados, na ordem digitada.
    const diasTodos = String(prazo || "").match(/\d+/g) || [];
    const valor = diasTodos.length ? diasTodos.join("/") + " dias" : "";
    aba.getRange("S1").setValue(valor);

    _log(vendedorId, "SALVAR_PRAZO_PAGAMENTO", nomeAba + " -> " + (valor || "(vazio)"));
    return { ok: true, prazoPagamento: valor, prazoPagamentoDias: diasTodos.length ? parseInt(diasTodos[0], 10) : 0 };
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// SALVAR DESCONTOS/ACRÉSCIMOS POR ESTADO (células T1/U1/V1 da aba do cliente)
// Positivo = acréscimo %, negativo = desconto %. Zero/vazio = desabilita auto-fill.
// ============================================================
function salvarDescontosEstado(nomeAba, descontos, token) {
  try {
    const vendedorId = _exigirSessao(token);
    if (!_validarAcesso(vendedorId, nomeAba)) return { ok: false, erro: "Acesso não autorizado." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(nomeAba);
    if (!aba) return { ok: false, erro: "Cliente não encontrado." };

    const pct = v => {
      const n = parseFloat(String(v || "").replace(",", "."));
      return isNaN(n) ? 0 : n;
    };
    const ba = pct(descontos.ba);
    const ce = pct(descontos.ce);
    const mg = pct(descontos.mg);

    aba.getRange("T1:V1").setValues([[ba !== 0 ? ba : "", ce !== 0 ? ce : "", mg !== 0 ? mg : ""]]);

    _log(vendedorId, "SALVAR_DESCONTOS_ESTADO", nomeAba + " -> BA:" + ba + "% CE:" + ce + "% MG:" + mg + "%");
    return { ok: true, descontoBA: ba, descontoCE: ce, descontoMG: mg };
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// CADASTRAR / EDITAR REFERÊNCIA
// ============================================================
function salvarReferencia(nomeAba, dados, token, linhaEdicao) {
  try {
    const vendedorId = _exigirSessao(token);
    if (!_validarAcesso(vendedorId, nomeAba)) return { ok: false, erro: "Acesso não autorizado." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(nomeAba);
    if (!aba) return { ok: false, erro: "Aba do cliente não encontrada." };

    const { ref, descricao, preco, dataInicio, dataFim, obs, unidade, medidaBase, precoRS, precoBA, precoCE, precoMG, peso } = dados;
    const pN = v => parseFloat(String(v || "0").replace(",", ".")) || 0;

    if (!ref || !dataInicio) return { ok: false, erro: "Referência e data de início são obrigatórios." };
    if (unidade !== "kg" && (!medidaBase || pN(medidaBase) <= 0)) return { ok: false, erro: "Informe a medida base (valor maior que zero)." };

    const dInicio = new Date(dataInicio);
    const dFim = dataFim ? new Date(dataFim) : null;

    if (dFim && dFim < dInicio) return { ok: false, erro: "Data de fim não pode ser anterior à data de início." };

    // Verificar sobreposição de datas para mesma referência
    const todasLinhas = aba.getDataRange().getValues();
    for (let i = 1; i < todasLinhas.length; i++) {
      if (linhaEdicao && (i + 1) === linhaEdicao) continue; // pula linha sendo editada
      const [rRef, , , rInicio, rFim] = todasLinhas[i];
      if (String(rRef).toUpperCase().trim() !== String(ref).toUpperCase().trim()) continue;

      const existInicio = rInicio ? new Date(rInicio) : null;
      const existFim = rFim ? new Date(rFim) : null;

      const sobreposicao = _datasSeOverlapam(dInicio, dFim, existInicio, existFim);
      if (sobreposicao) return { ok: false, erro: `Conflito de vigência com registro existente na linha ${i + 1}.` };
    }

    const linha = [
      ref.toUpperCase().trim(),
      descricao || "",
      pN(preco),
      dInicio,
      dFim || "",
      obs || "",
      unidade || "metros",
      pN(medidaBase),
      pN(precoRS),
      pN(precoBA),
      pN(precoCE),
      pN(precoMG),
      pN(peso)
    ];

    if (linhaEdicao) {
      aba.getRange(linhaEdicao, 1, 1, SCHEMA_CLIENTE.length).setValues([linha]);
    } else {
      aba.appendRow(linha);
    }

    _log(vendedorId, linhaEdicao ? "EDITAR" : "CADASTRAR", `${nomeAba} | ${ref}`);
    return { ok: true };
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// RENOVAR REFERÊNCIA — fecha período atual e abre novo
// ============================================================
function renovarReferencia(nomeAba, linhaOrigem, dados, token) {
  try {
    const vendedorId = _exigirSessao(token);
    if (!_validarAcesso(vendedorId, nomeAba)) return { ok: false, erro: "Acesso não autorizado." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(nomeAba);
    if (!aba) return { ok: false, erro: "Aba do cliente não encontrada." };

    const pN = v => parseFloat(String(v || "0").replace(",", ".")) || 0;
    const { preco, precoRS, precoBA, precoCE, precoMG, dataInicio, dataFim } = dados;

    if (!dataInicio) return { ok: false, erro: "Data de início é obrigatória." };
    if (!pN(precoRS) && !pN(precoBA) && !pN(precoCE) && !pN(precoMG))
      return { ok: false, erro: "Informe pelo menos um preço por estado." };

    const novaDataInicio = new Date(dataInicio);

    // Lê a linha existente para copiar dados base
    const linha = Number(linhaOrigem);
    const rowData = aba.getRange(linha, 1, 1, SCHEMA_CLIENTE.length).getValues()[0];

    // Fecha período atual: DataFim = novaDataInicio − 1 dia
    const dataFimAntiga = new Date(novaDataInicio);
    dataFimAntiga.setDate(dataFimAntiga.getDate() - 1);
    const celFim = aba.getRange(linha, 5);
    celFim.setValue(dataFimAntiga);
    celFim.setNumberFormat("dd/MM/yyyy");

    // Nova linha: mesmos dados base + novos preços/datas
    const novaLinha = [
      rowData[0],                        // ref
      rowData[1],                        // descricao
      pN(preco),                         // preco
      novaDataInicio,                    // dataInicio
      dataFim ? new Date(dataFim) : "",  // dataFim
      rowData[5],                        // obs
      rowData[6],                        // unidade
      rowData[7],                        // medidaBase
      pN(precoRS),
      pN(precoBA),
      pN(precoCE),
      pN(precoMG),
      rowData[12] || 0,                  // peso (copiado)
    ];

    aba.appendRow(novaLinha);
    const ultimaLinha = aba.getLastRow();
    aba.getRange(ultimaLinha, 4, 1, 2).setNumberFormat("dd/MM/yyyy");

    _log(vendedorId, "RENOVAR", `${nomeAba} | ${rowData[0]} | L${linha}→L${ultimaLinha}`);
    return { ok: true };
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// ADMIN: CRIAR NOVO CLIENTE (nova aba na planilha)
// ============================================================
function criarCliente(nome, token, prazoPagamento) {
  try {
    const vendedorId = _exigirSessao(token);
    if (!_ehAdmin(vendedorId)) return { ok: false, erro: "Sem permissão." };

    const nomeLimpo = String(nome || "").trim();
    if (!nomeLimpo) return { ok: false, erro: "Informe o nome do cliente." };

    // Nomes de abas no Google Sheets não podem ter: \ / ? * [ ] : < > e nem passar de 100 chars
    if (/[\\\/\?\*\[\]\:\<\>]/.test(nomeLimpo)) return { ok: false, erro: "Nome contém caracteres inválidos (\\  /  ?  *  [  ]  :  <  >)." };
    if (nomeLimpo.length > 90) return { ok: false, erro: "Nome muito longo (máximo 90 caracteres)." };

    const nomeAba = nomeLimpo.toUpperCase() + SUFIXO_CLIENTE;

    // getSheetByName é case-sensitive no GAS — varrer todas as abas para comparação segura
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const jaExiste = ss.getSheets().some(s => s.getName().toUpperCase() === nomeAba.toUpperCase());
    if (jaExiste) return { ok: false, erro: `Cliente "${nomeAba}" já existe.` };

    const aba = ss.insertSheet(nomeAba);

    // Cabeçalho conforme SCHEMA_CLIENTE
    const headers = SCHEMA_CLIENTE.map(c => c.nome);
    aba.appendRow(headers);
    aba.getRange(1, 1, 1, headers.length)
       .setFontWeight("bold")
       .setBackground("#0d0f14")
       .setFontColor("#e8a020");
    SCHEMA_CLIENTE.forEach((c, i) => aba.setColumnWidth(i + 1, c.largura));
    aba.getRange(2, 4, 500, 2).setNumberFormat("dd/MM/yyyy");

    // Prazo de pagamento (dias) — salvo na célula S1, fora do SCHEMA_CLIENTE.
    // Aceita um número único ("90") ou parcelado ("60/90", pagamento em parcelas).
    const diasPrazoTodos = String(prazoPagamento || "").match(/\d+/g) || [];
    if (diasPrazoTodos.length) aba.getRange("S1").setValue(diasPrazoTodos.join("/") + " dias");

    _log(vendedorId, "CRIAR_CLIENTE", nomeAba);
    return { ok: true, nomeAba };
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// CALCULAR PREÇO PROPORCIONAL
// ============================================================
function calcularPreco(preco, metros) {
  try {
    const p = Number(String(preco).replace(",", "."));
    const m = Number(String(metros).replace(",", "."));
    if (isNaN(p) || isNaN(m) || m <= 0) return { ok: false, erro: "Valores inválidos." };
    return { ok: true, total: (p * m).toFixed(2) };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// ADMIN: LISTAR VENDEDORES
// ============================================================
function getVendedores(token) {
  try {
    const vendedorId = _exigirSessao(token);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(ABA_VENDEDORES);
    if (!aba) return { ok: false, erro: "Aba VENDEDORES não encontrada." };

    if (!_ehAdmin(vendedorId)) return { ok: false, erro: "Sem permissão." };

    const dados = aba.getDataRange().getValues();
    const lista = [];
    for (let i = 1; i < dados.length; i++) {
      if (!dados[i][0]) continue;
      lista.push({
        id:       String(dados[i][0] || ""),
        nome:     String(dados[i][1] || ""),
        senha:    String(dados[i][2] || ""),
        clientes: String(dados[i][3] || ""),
        email:    String(dados[i][4] || ""),
        linha:    i + 1
      });
    }
    return { ok: true, vendedores: lista };
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// ADMIN: SALVAR VENDEDOR  (coluna E = email)
// ============================================================
function salvarVendedor(token, dados, linhaEdicao) {
  try {
    const vendedorId = _exigirSessao(token);
    if (!_ehAdmin(vendedorId)) return { ok: false, erro: "Sem permissão." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(ABA_VENDEDORES);
    if (!aba) return { ok: false, erro: "Aba VENDEDORES não encontrada." };

    const linha = [dados.id, dados.nome, dados.senha, dados.clientes, dados.email || ""];

    if (linhaEdicao) {
      aba.getRange(linhaEdicao, 1, 1, 5).setValues([linha]);
    } else {
      aba.appendRow(linha);
    }

    return { ok: true };
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// ADMIN: ENVIAR EMAIL DE ATUALIZAÇÃO DE PREÇOS
// ============================================================
function enviarEmailAtualizacao(nomeAba, token) {
  try {
    const vendedorIdRemetente = _exigirSessao(token);
    if (!_ehAdmin(vendedorIdRemetente)) return { ok: false, erro: "Sem permissão." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const abaV = ss.getSheetByName(ABA_VENDEDORES);
    if (!abaV) return { ok: false, erro: "Aba VENDEDORES não encontrada." };

    // Buscar referências vigentes do cliente para montar o email
    const resRefs = _getReferencias(nomeAba, "", vendedorIdRemetente);
    if (!resRefs.ok) return { ok: false, erro: resRefs.erro };
    const refs = resRefs.refs;

    // Identificar vendedores com acesso ao cliente e com email cadastrado
    const dadosV = abaV.getDataRange().getValues();
    const destinatarios = [];
    const semEmail = [];

    for (let i = 1; i < dadosV.length; i++) {
      if (!dadosV[i][0]) continue;
      const clientes = String(dadosV[i][3] || "").split("|").map(c => c.trim().toUpperCase());
      const temAcesso = clientes.includes("*") || clientes.includes(nomeAba.toUpperCase());
      if (!temAcesso) continue;

      const email = String(dadosV[i][4] || "").trim();
      const nome  = String(dadosV[i][1] || "");
      if (email && email.includes("@")) {
        destinatarios.push({ nome, email });
      } else {
        semEmail.push(nome);
      }
    }

    if (destinatarios.length === 0) {
      return { ok: false, erro: "Nenhum vendedor com email cadastrado para este cliente.", semEmail };
    }

    const nomeCliente = nomeAba.replace(/ CLIENTE$/i, "");
    const hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");

    // Montar linhas da tabela — apenas vigentes no email
    const vigentes = refs.filter(r => r.vigente);
    const fmtBRL = v => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const linhasTabela = vigentes.map(r => {
      const unidLabel = r.unidade === "pares" ? "par" : r.unidade === "pecas" ? "peça" : r.unidade === "kg" ? "kg" : "metro";
      const medLabel = r.medidaBase > 0 ? ` (${r.medidaBase}${r.unidade === "metros" ? "mm" : "cm"})` : "";
      const estados = [["RS", r.precoRS], ["BA", r.precoBA], ["CE", r.precoCE], ["MG", r.precoMG]]
        .filter(([, p]) => p > 0)
        .map(([uf, p]) => `<span style="background:#f5f5f5;border-radius:4px;padding:1px 6px;font-size:11px">${uf}: ${fmtBRL(p)}</span>`)
        .join(" ");
      return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-weight:600">${r.ref}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#555">${r.descricao || "–"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:#c07010">
          ${fmtBRL(r.preco)}
          <div style="font-size:10px;color:#999;font-weight:400">por ${unidLabel}${medLabel}</div>
          ${estados ? `<div style="margin-top:4px;text-align:left">${estados}</div>` : ""}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:12px;color:#888">
          ${r.dataInicio || "–"} → ${r.dataFim}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#777">${r.obs || ""}</td>
      </tr>`;
    }).join("");

    const erros = [];
    let enviados = 0;

    for (const dest of destinatarios) {
      const corpoHtml = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#222">
        <div style="background:#0d0f14;padding:20px 24px;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:space-between">
          <img src="https://i.ibb.co/FGGjdsM/LOGO-MARFIM.jpg" style="height:44px;width:auto">
          <div style="color:#e8a020;font-size:13px;text-align:right">Atualização de Tabela de Preços<br><span style="color:#8890a8;font-size:11px">${hoje}</span></div>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
          <p style="margin-bottom:6px">Olá, <strong>${dest.nome}</strong>.</p>
          <p style="margin-bottom:20px;color:#555">A tabela de preços do cliente <strong>${nomeCliente}</strong> foi atualizada. Confira abaixo os preços vigentes:</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="background:#f9f9f9">
                <th style="padding:10px 12px;text-align:left;color:#888;font-size:11px;text-transform:uppercase;border-bottom:2px solid #e5e7eb">Referência</th>
                <th style="padding:10px 12px;text-align:left;color:#888;font-size:11px;text-transform:uppercase;border-bottom:2px solid #e5e7eb">Descrição</th>
                <th style="padding:10px 12px;text-align:right;color:#888;font-size:11px;text-transform:uppercase;border-bottom:2px solid #e5e7eb">Preço Base</th>
                <th style="padding:10px 12px;text-align:center;color:#888;font-size:11px;text-transform:uppercase;border-bottom:2px solid #e5e7eb">Vigência</th>
                <th style="padding:10px 12px;text-align:left;color:#888;font-size:11px;text-transform:uppercase;border-bottom:2px solid #e5e7eb">Obs</th>
              </tr>
            </thead>
            <tbody>${linhasTabela}</tbody>
          </table>
          ${vigentes.length === 0 ? '<p style="color:#999;text-align:center;padding:20px">Nenhum preço vigente no momento.</p>' : ""}
          <p style="margin-top:24px;font-size:12px;color:#aaa">Este é um email automático gerado pelo sistema de tabela de preços Marfim. Não responda a este email.</p>
        </div>
      </div>`;

      try {
        MailApp.sendEmail({
          to: dest.email,
          replyTo: "marco@marfim.ind.br",
          subject: `[Marfim] Atualização de preços — ${nomeCliente}`,
          htmlBody: corpoHtml
        });
        enviados++;
        _log(vendedorIdRemetente, "EMAIL", `${nomeAba} → ${dest.email}`);
      } catch (e) {
        erros.push(`${dest.nome} (${dest.email}): ${e.message}`);
      }
    }

    return {
      ok: true,
      enviados,
      semEmail,
      erros,
      msg: `${enviados} email(s) enviado(s).${semEmail.length ? " Sem email: " + semEmail.join(", ") + "." : ""}${erros.length ? " Falhas: " + erros.join("; ") : ""}`
    };
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// NOTIFICAR VENDEDORES — email sobre UMA referência específica
// ============================================================
function enviarEmailReferencia(nomeAba, refDados, token) {
  try {
    const vendedorId = _exigirSessao(token);
    if (!_ehAdmin(vendedorId)) return { ok: false, erro: "Sem permissão." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const abaV = ss.getSheetByName(ABA_VENDEDORES);
    if (!abaV) return { ok: false, erro: "Aba VENDEDORES não encontrada." };

    const dadosV = abaV.getDataRange().getValues();
    const destinatarios = [];
    const semEmail = [];

    for (let i = 1; i < dadosV.length; i++) {
      if (!dadosV[i][0]) continue;
      const clientes = String(dadosV[i][3] || "").split("|").map(c => c.trim().toUpperCase());
      const temAcesso = clientes.includes("*") || clientes.includes(nomeAba.toUpperCase());
      if (!temAcesso) continue;
      const email = String(dadosV[i][4] || "").trim();
      const nome  = String(dadosV[i][1] || "");
      if (email && email.includes("@")) destinatarios.push({ nome, email });
      else semEmail.push(nome);
    }

    if (destinatarios.length === 0) {
      return { ok: false, erro: "Nenhum vendedor com email cadastrado para este cliente.", semEmail };
    }

    const pN = v => parseFloat(String(v || "0").replace(",", ".")) || 0;
    const escH = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const nomeCliente = nomeAba.replace(/ CLIENTE$/i, "");
    const hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");
    const fmtBRL = v => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    const ref        = escH(String(refDados.ref || ""));
    const descricao  = escH(String(refDados.descricao || ""));
    const unidade    = String(refDados.unidade || "metros");
    const medidaBase = pN(refDados.medidaBase);
    const precoBase  = pN(refDados.preco);
    const precoRS    = pN(refDados.precoRS);
    const precoBA    = pN(refDados.precoBA);
    const precoCE    = pN(refDados.precoCE);
    const precoMG    = pN(refDados.precoMG);
    const dataInicio = escH(String(refDados.dataInicio || "–"));
    const dataFim    = escH(String(refDados.dataFim || "Sem vencimento"));
    const obs        = escH(String(refDados.obs || ""));

    const unidLabel  = unidade === "pares" ? "par" : unidade === "pecas" ? "peça" : unidade === "kg" ? "kg" : "metro";
    const medSufixo  = unidade === "metros" ? "mm" : "cm";
    const medLabel   = medidaBase > 0 ? ` (base: ${medidaBase}${medSufixo})` : "";

    const estadosCells = [["RS", precoRS], ["BA", precoBA], ["CE", precoCE], ["MG", precoMG]]
      .filter(([, p]) => p > 0)
      .map(([uf, p]) => `<td style="padding:10px 14px;text-align:center;border-right:1px solid #e5e7eb">
          <div style="font-size:10px;font-weight:700;color:#888;letter-spacing:.08em;margin-bottom:4px">${uf}</div>
          <div style="font-size:15px;font-weight:700;color:#0d0f14">${fmtBRL(p)}</div>
        </td>`)
      .join("");

    const erros = [];
    let enviados = 0;

    for (const dest of destinatarios) {
      const corpoHtml = `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#222">
        <div style="background:#0d0f14;padding:20px 24px;border-radius:8px 8px 0 0">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td><img src="https://i.ibb.co/FGGjdsM/LOGO-MARFIM.jpg" style="height:44px;width:auto"></td>
            <td align="right" style="color:#e8a020;font-size:13px">
              Atualização de Preço<br><span style="color:#8890a8;font-size:11px">${hoje}</span>
            </td>
          </tr></table>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px 28px;border-radius:0 0 8px 8px">
          <p style="margin:0 0 6px 0">Olá, <strong>${escH(dest.nome)}</strong>.</p>
          <p style="margin:0 0 20px 0;color:#555">
            O preço da referência abaixo foi atualizado para o cliente <strong>${escH(nomeCliente)}</strong>:
          </p>
          <div style="background:#f8f9fa;border:1px solid #e5e7eb;border-left:4px solid #e8a020;border-radius:6px;padding:18px 20px;margin-bottom:20px">
            <div style="font-size:20px;font-weight:700;color:#0d0f14;margin-bottom:${descricao ? "4px" : "12px"}">${ref}</div>
            ${descricao ? `<div style="font-size:13px;color:#666;margin-bottom:12px">${descricao}</div>` : ""}
            <div style="margin-bottom:${estadosCells ? "14px" : "0"}">
              <span style="font-size:22px;font-weight:700;color:#c07010">${fmtBRL(precoBase || precoRS)}</span>
              <span style="font-size:12px;color:#888;margin-left:6px">por ${unidLabel}${medLabel}</span>
            </div>
            ${estadosCells ? `
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;margin-bottom:14px">
              <div style="padding:6px 14px;background:#f0f0f0;font-size:10px;font-weight:700;color:#888;letter-spacing:.06em">PREÇOS POR ESTADO</div>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${estadosCells}</tr></table>
            </div>` : ""}
            <div style="font-size:12px;color:#666;border-top:1px solid #e5e7eb;padding-top:12px">
              <strong>Vigência:</strong>&nbsp;${dataInicio} &rarr; ${dataFim}
              ${obs ? `<br><strong>Obs:</strong>&nbsp;${obs}` : ""}
            </div>
          </div>
          <p style="margin:0;font-size:11px;color:#aaa;text-align:center">
            Email automático gerado pelo sistema de tabela de preços Marfim. Não responda.
          </p>
        </div>
      </div>`;

      try {
        MailApp.sendEmail({
          to: dest.email,
          replyTo: "marco@marfim.ind.br",
          subject: `[Marfim] Novo preço — ${nomeCliente}: ${ref}`,
          htmlBody: corpoHtml
        });
        enviados++;
        _log(vendedorId, "EMAIL_REF", `${nomeAba} | ${ref} → ${dest.email}`);
      } catch (e) {
        erros.push(`${dest.nome} (${dest.email}): ${e.message}`);
      }
    }

    return {
      ok: true,
      enviados,
      semEmail,
      erros,
      msg: `${enviados} email(s) enviado(s).${semEmail.length ? " Sem email: " + semEmail.join(", ") + "." : ""}${erros.length ? " Falhas: " + erros.join("; ") : ""}`
    };
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// CONFERIR: NOTIFICAR DIREÇÃO SOBRE ITEM SEM PREÇO CADASTRADO
// Disparado pelo botão "Comunicar à direção" quando a conferência de PDF
// encontra um item cuja referência não está cadastrada na tabela do cliente.
// Destinatários: vendedores admin (coluna D = "*") com email cadastrado.
// replyTo: email cadastrado do vendedor que solicitou (não o remetente fixo
// usado nos outros emails), para que a resposta vá direto para quem pediu.
// ============================================================
function notificarItemSemPreco(dados, token) {
  try {
    const vendedorId = _exigirSessao(token);
    if (!_validarAcesso(vendedorId, dados.cliente)) return { ok: false, erro: "Acesso não autorizado." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const abaV = ss.getSheetByName(ABA_VENDEDORES);
    if (!abaV) return { ok: false, erro: "Aba VENDEDORES não encontrada." };

    const dadosV = abaV.getDataRange().getValues();
    let remetenteNome = "Vendedor", remetenteEmail = "";
    const admins = [];

    for (let i = 1; i < dadosV.length; i++) {
      if (!dadosV[i][0]) continue;
      const id       = String(dadosV[i][0]).trim();
      const nome     = String(dadosV[i][1] || "");
      const email    = String(dadosV[i][4] || "").trim();
      const clientes = String(dadosV[i][3] || "").split("|").map(c => c.trim());

      if (id === String(vendedorId).trim()) {
        remetenteNome = nome || remetenteNome;
        remetenteEmail = email;
      }
      if (clientes.includes("*") && email && email.includes("@")) {
        admins.push({ nome, email });
      }
    }

    if (admins.length === 0) {
      return { ok: false, erro: "Nenhum administrador com email cadastrado." };
    }

    const escH = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const pN = v => parseFloat(String(v || "0").replace(",", ".")) || 0;
    const fmtBRL = v => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    const nomeCliente = String(dados.cliente || "").replace(/ CLIENTE$/i, "");
    const uf       = escH(String(dados.uf || ""));
    const arquivo  = escH(String(dados.arquivo || ""));
    const ordem    = escH(String(dados.ordem || ""));
    const marca    = escH(String(dados.marca || ""));
    const emissao  = escH(String(dados.emissao || ""));
    const precoPdf = pN(dados.precoPdf);
    const qtd      = pN(dados.qtd);
    const trecho   = escH(String(dados.trecho || "")).replace(/\n/g, "<br>");
    const hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");

    const attachments = [];
    let notaAnexo = "";
    if (dados.pdfBase64) {
      try {
        const blob = Utilities.newBlob(Utilities.base64Decode(dados.pdfBase64), "application/pdf", dados.arquivo || "pedido.pdf");
        attachments.push(blob);
        notaAnexo = `<div style="font-size:12px;color:#555;margin-top:14px">&#x1F4CE; Pedido em anexo (${arquivo}).</div>`;
      } catch (e) {
        notaAnexo = `<div style="font-size:12px;color:#a00;margin-top:14px">Não foi possível anexar o PDF do pedido — verifique o arquivo original (${arquivo}).</div>`;
      }
    } else if (dados.pdfOmitido === "tamanho") {
      notaAnexo = `<div style="font-size:12px;color:#a00;margin-top:14px">Pedido não anexado (arquivo maior que 10MB) — verifique o arquivo original (${arquivo}).</div>`;
    }

    const detalhes = [
      ordem ? `<strong>OC:</strong> ${ordem}` : "",
      marca ? `<strong>Marca:</strong> ${marca}` : "",
      emissao ? `<strong>Emissão:</strong> ${emissao}` : ""
    ].filter(Boolean).join(" &nbsp; ");

    const corpoHtml = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#222">
      <div style="background:#0d0f14;padding:20px 24px;border-radius:8px 8px 0 0">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><img src="https://i.ibb.co/FGGjdsM/LOGO-MARFIM.jpg" style="height:44px;width:auto"></td>
          <td align="right" style="color:#e8a020;font-size:13px">
            Item sem preço cadastrado<br><span style="color:#8890a8;font-size:11px">${hoje}</span>
          </td>
        </tr></table>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px 28px;border-radius:0 0 8px 8px">
        <p style="margin:0 0 6px 0">Olá, Direção.</p>
        <p style="margin:0 0 20px 0;color:#555">
          <strong>${escH(remetenteNome)}</strong> está conferindo um pedido do cliente <strong>${escH(nomeCliente)}</strong> (tabela ${uf}) e encontrou um item que não está cadastrado na tabela de preços.
        </p>
        <div style="background:#f8f9fa;border:1px solid #e5e7eb;border-left:4px solid #e8a020;border-radius:6px;padding:18px 20px;margin-bottom:20px">
          <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:.06em;margin-bottom:10px">ITEM NÃO ENCONTRADO NA TABELA</div>
          <div style="font-size:13px;color:#444;line-height:1.6">
            <strong>Arquivo:</strong> ${arquivo}<br>
            ${detalhes ? detalhes + "<br>" : ""}
            <strong>Preço no pedido:</strong> ${fmtBRL(precoPdf)} &nbsp; <strong>Quantidade:</strong> ${qtd || "–"}
          </div>
          <div style="font-size:10px;font-weight:700;color:#888;letter-spacing:.06em;margin:14px 0 6px">TRECHO DO PEDIDO (PARA IDENTIFICAÇÃO)</div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:4px;padding:10px 12px;font-family:monospace;font-size:11px;color:#555;white-space:pre-wrap">${trecho}</div>
        </div>
        ${notaAnexo}
        <p style="margin:0;font-size:11px;color:#aaa;text-align:center">
          Solicitado por ${escH(remetenteNome)}${remetenteEmail ? " (" + escH(remetenteEmail) + ")" : ""}. Responda este email para falar diretamente com quem solicitou.
        </p>
      </div>
    </div>`;

    const destinatarios = admins.map(a => a.email).join(",");
    const opcoesEmail = {
      to: destinatarios,
      subject: `[Marfim] Item sem preço cadastrado — ${nomeCliente}: solicitação de ${remetenteNome}`,
      htmlBody: corpoHtml
    };
    if (remetenteEmail && remetenteEmail.includes("@")) opcoesEmail.replyTo = remetenteEmail;
    if (attachments.length) opcoesEmail.attachments = attachments;

    MailApp.sendEmail(opcoesEmail);
    _log(vendedorId, "NOTIFICAR_SEM_PRECO", `${dados.cliente} | ${arquivo} -> ${destinatarios}`);

    return {
      ok: true,
      msg: `Direção notificada (${admins.length} destinatário(s)).${remetenteEmail ? "" : " Atenção: seu cadastro não tem email — a resposta não poderá vir direto para você."}`
    };
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// UTILITÁRIOS INTERNOS
// ============================================================
function _validarAcesso(vendedorId, nomeAba) {
  const vendedor = _buscarVendedor(vendedorId);
  if (!vendedor) return false;
  const clientes = vendedor.clientes.map(c => c.toUpperCase());
  if (clientes.includes("*")) return true;
  return clientes.includes(String(nomeAba).toUpperCase());
}

function _ehAdmin(vendedorId) {
  const vendedor = _buscarVendedor(vendedorId);
  if (!vendedor) return false;
  return vendedor.clientes.includes("*");
}

function _datasSeOverlapam(ini1, fim1, ini2, fim2) {
  // Trata null/undefined como infinito
  const s1 = ini1 ? ini1.getTime() : -Infinity;
  const e1 = fim1 ? fim1.getTime() : Infinity;
  const s2 = ini2 ? ini2.getTime() : -Infinity;
  const e2 = fim2 ? fim2.getTime() : Infinity;
  return s1 <= e2 && s2 <= e1;
}

// ============================================================
// BACKUP AUTOMÁTICO — envia por email um .csv de cada aba de cliente
// a todos os administradores (coluna D = "*") com email cadastrado.
//
// Como ligar: rode UMA VEZ a função criarGatilhoBackup() no editor do
// Apps Script. Ela instala um gatilho de tempo que roda backupQuinzenal()
// diariamente; a função só dispara o email quando já se passaram
// BACKUP_INTERVALO_DIAS dias desde o último envio (guardado em
// PropertiesService). Rodar diário + checar a data é mais confiável que
// pedir ao Google "a cada 15 dias": se uma execução falhar ou o servidor
// pular um dia, o envio se recupera sozinho no dia seguinte.
// ============================================================
const BACKUP_INTERVALO_DIAS = 15;
const BACKUP_PROP_ULTIMO = "backup_ultimo_envio";

// Converte uma aba inteira em texto CSV, com escape correto de aspas,
// vírgulas e quebras de linha, e datas formatadas dd/MM/yyyy.
function _gerarCsvAba(aba) {
  const dados = aba.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  return dados.map(linha => linha.map(cel => {
    let v;
    if (cel instanceof Date) v = Utilities.formatDate(cel, tz, "dd/MM/yyyy");
    else v = String(cel == null ? "" : cel);
    if (/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }).join(",")).join("\r\n");
}

// Monta e envia o email de backup com um anexo CSV por aba de cliente.
// Reutilizável: chamada pelo gatilho (backupQuinzenal) e pelo botão manual
// do admin (enviarBackupManual).
function enviarBackupClientes() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const abaV = ss.getSheetByName(ABA_VENDEDORES);
    if (!abaV) return { ok: false, erro: "Aba VENDEDORES não encontrada." };

    const dadosV = abaV.getDataRange().getValues();
    const admins = [];
    for (let i = 1; i < dadosV.length; i++) {
      if (!dadosV[i][0]) continue;
      const clientes = String(dadosV[i][3] || "").split("|").map(c => c.trim());
      const email = String(dadosV[i][4] || "").trim();
      if (clientes.includes("*") && email && email.includes("@")) admins.push(email);
    }
    if (admins.length === 0) return { ok: false, erro: "Nenhum administrador com email cadastrado." };

    const abasCliente = ss.getSheets().filter(s => s.getName().toUpperCase().endsWith(SUFIXO_CLIENTE.toUpperCase()));
    if (abasCliente.length === 0) return { ok: false, erro: "Nenhuma aba de cliente encontrada." };

    const tz = Session.getScriptTimeZone();
    const hoje = Utilities.formatDate(new Date(), tz, "dd/MM/yyyy");
    const stamp = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");

    // Um anexo .csv por cliente. O prefixo ﻿ (BOM UTF-8) faz o Excel
    // abrir os acentos corretamente ao dar duplo clique no arquivo.
    const attachments = abasCliente.map(aba => {
      const csv = _gerarCsvAba(aba);
      const nomeArq = aba.getName().replace(/ CLIENTE$/i, "").replace(/[^\w.-]+/g, "_") + "_" + stamp + ".csv";
      return Utilities.newBlob("\uFEFF" + csv, "text/csv", nomeArq);
    });

    const listaClientes = abasCliente
      .map(a => `<li style="margin-bottom:2px">${a.getName().replace(/ CLIENTE$/i, "")}</li>`)
      .join("");

    const corpoHtml = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#222">
      <div style="background:#0d0f14;padding:20px 24px;border-radius:8px 8px 0 0">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><img src="https://i.ibb.co/FGGjdsM/LOGO-MARFIM.jpg" style="height:44px;width:auto"></td>
          <td align="right" style="color:#e8a020;font-size:13px">
            Backup das tabelas de preço<br><span style="color:#8890a8;font-size:11px">${hoje}</span>
          </td>
        </tr></table>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px 28px;border-radius:0 0 8px 8px">
        <p style="margin:0 0 6px 0">Olá, Direção.</p>
        <p style="margin:0 0 16px 0;color:#555">
          Segue o backup automático das tabelas de preço. Cada cliente vem como um arquivo <strong>.csv</strong> em anexo (${abasCliente.length} no total) — guarde este email ou salve os arquivos em local seguro.
        </p>
        <div style="font-size:10px;font-weight:700;color:#888;letter-spacing:.06em;margin-bottom:6px">CLIENTES NESTE BACKUP</div>
        <ul style="margin:0 0 16px 18px;padding:0;font-size:13px;color:#444">${listaClientes}</ul>
        <p style="margin:0;font-size:11px;color:#aaa;text-align:center">
          Email automático gerado pelo sistema de tabela de preços Marfim. Não responda.
        </p>
      </div>
    </div>`;

    MailApp.sendEmail({
      to: admins.join(","),
      subject: `[Marfim] Backup das tabelas de preço — ${hoje}`,
      htmlBody: corpoHtml,
      attachments: attachments
    });

    _log("SISTEMA", "BACKUP", `${abasCliente.length} aba(s) -> ${admins.join(", ")}`);
    return { ok: true, abas: abasCliente.length, destinatarios: admins.length,
             msg: `Backup enviado: ${abasCliente.length} cliente(s) para ${admins.length} administrador(es).` };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// Alvo do gatilho de tempo. Só envia quando já passaram BACKUP_INTERVALO_DIAS
// dias desde o último envio bem-sucedido.
function backupQuinzenal() {
  const props = PropertiesService.getScriptProperties();
  const ultimo = props.getProperty(BACKUP_PROP_ULTIMO);
  const agora = Date.now();
  if (ultimo) {
    const diasPassados = (agora - Number(ultimo)) / (1000 * 60 * 60 * 24);
    if (diasPassados < BACKUP_INTERVALO_DIAS) return; // ainda não é hora
  }
  const res = enviarBackupClientes();
  if (res.ok) props.setProperty(BACKUP_PROP_ULTIMO, String(agora));
}

// Instala (ou reinstala, sem duplicar) o gatilho diário que aciona o backup.
// Rodar UMA vez no editor do Apps Script para ligar os backups automáticos.
function criarGatilhoBackup() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "backupQuinzenal") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("backupQuinzenal").timeBased().everyDays(1).atHour(6).create();
  return `Gatilho instalado: verificação diária às 6h, envio a cada ${BACKUP_INTERVALO_DIAS} dias.`;
}

// Botão "Enviar backup agora" da aba Admin — dispara o backup na hora,
// sem esperar o gatilho, e NÃO altera a data do próximo envio automático.
function enviarBackupManual(token) {
  try {
    const vendedorId = _exigirSessao(token);
    if (!_ehAdmin(vendedorId)) return { ok: false, erro: "Sem permissão." };
    return enviarBackupClientes();
  } catch (e) {
    if (e.message === "SESSAO_EXPIRADA") return { ok: false, erro: "Sessão expirada. Faça login novamente.", sessaoExpirada: true };
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// MIGRAÇÃO DE SCHEMA — aplica colunas ausentes em todas as abas de cliente
// Chamada automaticamente pelo setup(). Pode ser executada separadamente
// a qualquer momento sem risco de perda de dados.
// ============================================================
function migrarSchema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abasCliente = ss.getSheets().filter(s => s.getName().toUpperCase().endsWith(SUFIXO_CLIENTE.toUpperCase()));

  const adicionadas = [];
  const erros = [];

  for (const aba of abasCliente) {
    try {
      // Lê exatamente N colunas por posição (N = tamanho do schema).
      // Usar posição em vez de busca por nome evita que colunas de dados sem
      // cabeçalho (criadas por salvarReferencia antes da migração) sejam
      // detectadas como "ausentes" e adicionadas nas colunas erradas.
      const cabecalho = aba.getRange(1, 1, 1, SCHEMA_CLIENTE.length).getValues()[0]
                           .map(v => String(v).trim());

      const colsAdicionadas = [];
      for (let i = 0; i < SCHEMA_CLIENTE.length; i++) {
        const colDef = SCHEMA_CLIENTE[i];
        const colNum = i + 1;
        if (cabecalho[i].toUpperCase() === colDef.nome.toUpperCase()) continue;
        if (cabecalho[i] !== "") continue; // posição ocupada por coluna desconhecida — não sobrescreve
        aba.getRange(1, colNum)
           .setValue(colDef.nome)
           .setFontWeight("bold")
           .setBackground("#0d0f14")
           .setFontColor("#e8a020");
        aba.setColumnWidth(colNum, colDef.largura);
        colsAdicionadas.push(colDef.nome);
      }

      if (colsAdicionadas.length > 0) {
        adicionadas.push(`${aba.getName()}: +${colsAdicionadas.join(", ")}`);
      }
    } catch(e) {
      erros.push(`${aba.getName()}: ${e.message}`);
    }
  }

  return { adicionadas, erros };
}

// ============================================================
// SETUP — rodar para criar a estrutura inicial ou após atualizações
// ============================================================
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  let criadas = [];
  let jaExistiam = [];

  // ── ABA VENDEDORES ──────────────────────────────────────────
  let abaV = ss.getSheetByName(ABA_VENDEDORES);
  if (!abaV) {
    abaV = ss.insertSheet(ABA_VENDEDORES);
    abaV.appendRow(["ID", "Nome", "Senha", "Clientes", "Email"]);
    // Admin padrão: id=ADMIN, senha=1234, acesso total
    abaV.appendRow(["ADMIN", "Administrador", "1234", "*", ""]);
    abaV.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#0d0f14").setFontColor("#e8a020");
    abaV.setColumnWidth(1, 80);
    abaV.setColumnWidth(2, 180);
    abaV.setColumnWidth(3, 100);
    abaV.setColumnWidth(4, 280);
    abaV.setColumnWidth(5, 200);
    criadas.push(ABA_VENDEDORES);
  } else {
    // Garantir coluna Email no cabeçalho se já existir a aba
    const cab = abaV.getRange(1, 1, 1, 5).getValues()[0];
    if (!cab[4] || cab[4].toString().trim() === "") {
      abaV.getRange(1, 5).setValue("Email");
    }
    jaExistiam.push(ABA_VENDEDORES);
  }

  // ── ABA LOG ────────────────────────────────────────────────
  let abaLog = ss.getSheetByName(ABA_LOG);
  if (!abaLog) {
    abaLog = ss.insertSheet(ABA_LOG);
    abaLog.appendRow(["Data/Hora", "Vendedor", "Ação", "Detalhe"]);
    abaLog.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#0d0f14").setFontColor("#e8a020");
    abaLog.setColumnWidth(1, 160);
    abaLog.setColumnWidth(2, 140);
    abaLog.setColumnWidth(3, 120);
    abaLog.setColumnWidth(4, 300);
    criadas.push(ABA_LOG);
  } else {
    jaExistiam.push(ABA_LOG);
  }

  // ── ABA EXEMPLO DE CLIENTE ─────────────────────────────────
  const abaExemplo = "EXEMPLO CLIENTE";
  let abaEx = ss.getSheetByName(abaExemplo);
  if (!abaEx) {
    abaEx = ss.insertSheet(abaExemplo);
    abaEx.appendRow(SCHEMA_CLIENTE.map(c => c.nome));
    abaEx.getRange(1, 1, 1, SCHEMA_CLIENTE.length).setFontWeight("bold").setBackground("#0d0f14").setFontColor("#e8a020");
    // Linhas de exemplo
    abaEx.appendRow(["CAD001-BRANCO", "Cadarço Tênis Branco", 1.00, new Date(), "", "Preço por par", "pares", 100, 0, 0, 0, 0]);
    abaEx.appendRow(["FIT001-PRETO", "Fita Elástica Preta 10mm", 0.90, new Date(), "", "Preço por metro", "metros", 10, 0, 0, 0, 0]);
    SCHEMA_CLIENTE.forEach((c, i) => abaEx.setColumnWidth(i + 1, c.largura));
    // Formatar coluna de datas
    abaEx.getRange(2, 4, 100, 2).setNumberFormat("dd/MM/yyyy");
    criadas.push(abaExemplo);
  } else {
    jaExistiam.push(abaExemplo);
  }

  // ── PROTEGER ABA LOG (somente leitura para editores) ───────
  try {
    const protecoes = abaLog.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    if (protecoes.length === 0) {
      const prot = abaLog.protect().setDescription("LOG protegido — não editar manualmente");
      prot.removeEditors(prot.getEditors());
      if (prot.canDomainEdit()) prot.setDomainEdit(false);
    }
  } catch(e) { /* ignora erro de permissão */ }

  // ── MIGRAÇÃO DE SCHEMA ─────────────────────────────────────
  const migracao = migrarSchema();

  // ── RELATÓRIO FINAL ────────────────────────────────────────
  const msg = [
    "✅ Setup concluído!\n",
    criadas.length              ? "Criadas: "                + criadas.join(", ")           : "",
    jaExistiam.length           ? "Já existiam: "            + jaExistiam.join(", ")        : "",
    migracao.adicionadas.length ? "\n── Colunas adicionadas ──\n" + migracao.adicionadas.join("\n") : "── Schema das abas de cliente: OK",
    migracao.erros.length       ? "\n⚠️ Erros na migração:\n"  + migracao.erros.join("\n")  : "",
    "",
    "── Credencial admin padrão ──",
    "ID: ADMIN",
    "Senha: 1234",
    "(Altere a senha após o primeiro acesso)"
  ].filter(Boolean).join("\n");

  ui.alert("Setup — Tabela de Preços Marfim", msg, ui.ButtonSet.OK);
}

function _log(vendedor, acao, detalhe) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let aba = ss.getSheetByName(ABA_LOG);
    if (!aba) {
      aba = ss.insertSheet(ABA_LOG);
      aba.appendRow(["Data/Hora", "Vendedor", "Ação", "Detalhe"]);
    }
    aba.appendRow([new Date(), vendedor, acao, detalhe]);
  } catch (e) { /* log não pode travar o sistema */ }
}
