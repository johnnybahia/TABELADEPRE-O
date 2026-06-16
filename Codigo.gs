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
// AUTENTICAÇÃO
// ============================================================
function login(id, senha) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(ABA_VENDEDORES);
    if (!aba) return { ok: false, erro: "Aba VENDEDORES não encontrada." };

    const dados = aba.getDataRange().getValues();
    for (let i = 1; i < dados.length; i++) {
      const [vid, nome, vsenha, clientes] = dados[i];
      if (String(vid).trim() === String(id).trim() &&
          String(vsenha).trim() === String(senha).trim()) {
        const clientesPermitidos = String(clientes).split("|").map(c => c.trim()).filter(Boolean);
        _log(nome, "LOGIN", "");
        return { ok: true, vendedor: { id: vid, nome, clientes: clientesPermitidos } };
      }
    }
    return { ok: false, erro: "Credenciais inválidas." };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// LISTAR CLIENTES DISPONÍVEIS PARA O VENDEDOR
// ============================================================
function getClientes(vendedorId, clientesPermitidos) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const todasAbas = ss.getSheets().map(s => s.getName());
    const abasCliente = todasAbas.filter(n => n.toUpperCase().endsWith(SUFIXO_CLIENTE));

    if (!clientesPermitidos || clientesPermitidos.length === 0) return { ok: true, clientes: [] };

    // Se lista contém "*", libera todos
    const liberaTudo = clientesPermitidos.includes("*");

    const resultado = abasCliente.filter(nome => {
      if (liberaTudo) return true;
      return clientesPermitidos.some(p => p.toUpperCase() === nome.toUpperCase());
    });

    return { ok: true, clientes: resultado };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// BUSCAR REFERÊNCIAS POR CLIENTE (com filtro de busca e vigência)
// ============================================================
function getReferencias(nomeAba, busca, vendedorId) {
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

    // Prazo de pagamento do cliente (célula S1, fora do SCHEMA_CLIENTE)
    const prazoRaw = String(aba.getRange("S1").getValue() || "").trim();
    const prazoMatch = prazoRaw.match(/(\d+)/);
    const prazoPagamentoDias = prazoMatch ? parseInt(prazoMatch[1], 10) : 0;

    // Descontos/acréscimos por estado em % (células T1/U1/V1, fora do SCHEMA_CLIENTE)
    // Positivo = acréscimo, negativo = desconto. Zero/vazio = sem auto-preenchimento.
    const [dBA, dCE, dMG] = aba.getRange("T1:V1").getValues()[0];
    const descontoBA = pN(dBA);
    const descontoCE = pN(dCE);
    const descontoMG = pN(dMG);

    return { ok: true, refs: resultado, prazoPagamento: prazoRaw, prazoPagamentoDias, descontoBA, descontoCE, descontoMG };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// SALVAR PRAZO DE PAGAMENTO (célula S1 da aba do cliente)
// ============================================================
function salvarPrazoPagamento(nomeAba, prazo, vendedorId) {
  try {
    if (!_validarAcesso(vendedorId, nomeAba)) return { ok: false, erro: "Acesso não autorizado." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(nomeAba);
    if (!aba) return { ok: false, erro: "Cliente não encontrado." };

    const pN = v => parseFloat(String(v || "0").replace(",", ".")) || 0;
    const dias = Math.round(pN(prazo));
    const valor = dias > 0 ? dias + " dias" : "";
    aba.getRange("S1").setValue(valor);

    _log(vendedorId, "SALVAR_PRAZO_PAGAMENTO", nomeAba + " -> " + (valor || "(vazio)"));
    return { ok: true, prazoPagamento: valor, prazoPagamentoDias: dias > 0 ? dias : 0 };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// SALVAR DESCONTOS/ACRÉSCIMOS POR ESTADO (células T1/U1/V1 da aba do cliente)
// Positivo = acréscimo %, negativo = desconto %. Zero/vazio = desabilita auto-fill.
// ============================================================
function salvarDescontosEstado(nomeAba, descontos, vendedorId) {
  try {
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
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// CADASTRAR / EDITAR REFERÊNCIA
// ============================================================
function salvarReferencia(nomeAba, dados, vendedorId, linhaEdicao) {
  try {
    if (!_validarAcesso(vendedorId, nomeAba)) return { ok: false, erro: "Acesso não autorizado." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(nomeAba);
    if (!aba) return { ok: false, erro: "Aba do cliente não encontrada." };

    const { ref, descricao, preco, dataInicio, dataFim, obs, unidade, medidaBase, precoRS, precoBA, precoCE, precoMG, peso } = dados;
    const pN = v => parseFloat(String(v || "0").replace(",", ".")) || 0;

    if (!ref || !dataInicio) return { ok: false, erro: "Referência e data de início são obrigatórios." };
    if (!medidaBase || pN(medidaBase) <= 0) return { ok: false, erro: "Informe a medida base (valor maior que zero)." };

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
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// RENOVAR REFERÊNCIA — fecha período atual e abre novo
// ============================================================
function renovarReferencia(nomeAba, linhaOrigem, dados, vendedorId) {
  try {
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
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// ADMIN: CRIAR NOVO CLIENTE (nova aba na planilha)
// ============================================================
function criarCliente(nome, vendedorId, prazoPagamento) {
  try {
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

    // Prazo de pagamento (dias) — salvo na célula S1, fora do SCHEMA_CLIENTE
    const pN = v => parseFloat(String(v || "0").replace(",", ".")) || 0;
    const diasPrazo = Math.round(pN(prazoPagamento));
    if (diasPrazo > 0) aba.getRange("S1").setValue(diasPrazo + " dias");

    _log(vendedorId, "CRIAR_CLIENTE", nomeAba);
    return { ok: true, nomeAba };
  } catch (e) {
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
function getVendedores(vendedorId) {
  try {
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
        clientes: String(dados[i][3] || ""),
        email:    String(dados[i][4] || "")   // coluna E
      });
    }
    return { ok: true, vendedores: lista };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// ADMIN: SALVAR VENDEDOR  (coluna E = email)
// ============================================================
function salvarVendedor(vendedorId, dados, linhaEdicao) {
  try {
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
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// ADMIN: ENVIAR EMAIL DE ATUALIZAÇÃO DE PREÇOS
// ============================================================
function enviarEmailAtualizacao(nomeAba, vendedorIdRemetente) {
  try {
    if (!_ehAdmin(vendedorIdRemetente)) return { ok: false, erro: "Sem permissão." };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const abaV = ss.getSheetByName(ABA_VENDEDORES);
    if (!abaV) return { ok: false, erro: "Aba VENDEDORES não encontrada." };

    // Buscar referências vigentes do cliente para montar o email
    const resRefs = getReferencias(nomeAba, "", vendedorIdRemetente);
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
      const unidLabel = r.unidade === "pares" ? "par" : r.unidade === "pecas" ? "peça" : "metro";
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
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// UTILITÁRIOS INTERNOS
// ============================================================
function _validarAcesso(vendedorId, nomeAba) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName(ABA_VENDEDORES);
  if (!aba) return false;

  const dados = aba.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][0]).trim() !== String(vendedorId).trim()) continue;
    const clientes = String(dados[i][3] || "").split("|").map(c => c.trim().toUpperCase());
    if (clientes.includes("*")) return true;
    if (clientes.includes(nomeAba.toUpperCase())) return true;
    return false;
  }
  return false;
}

function _ehAdmin(vendedorId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName(ABA_VENDEDORES);
  if (!aba) return false;
  const dados = aba.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][0]).trim() !== String(vendedorId).trim()) continue;
    const clientes = String(dados[i][3] || "").split("|").map(c => c.trim());
    return clientes.includes("*");
  }
  return false;
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
