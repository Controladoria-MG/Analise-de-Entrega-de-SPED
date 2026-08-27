let dados = [];
// Subconjunto de `dados` só do Tipo SPED ativo (ver tipoSpedAtivo). ICMS e
// Contribuições são relatórios diferentes (regras de vencimento diferentes,
// pedido explícito do usuário 2026-08-20 pra "tratá-los separados"), então
// nada mistura os dois ao mesmo tempo.
let dadosTipo = [];
// `dadosTipo` recortado pela navegação (Unidade -> Departamento) — é o que
// todo o corpo do dashboard (filtros, cards, ranking, evolução, tabela)
// enxerga. Ver `escopo` e calcularDadosEscopo.
let dadosEscopo = [];
let tipoSpedAtivo = null;
// Navegação em 3 telas, mesmo padrão do Portal de Tarefas / Controle de
// Fechamentos: `escopo.unidade` null = Painel de Unidades; unidade setada e
// `escopo.depto` null = tela da Unidade (visão consolidada + cards de
// Departamento pra detalhar); os dois setados = tela do Departamento.
let escopo = { unidade: null, depto: null };
let filtrados = [];
let filtradosTabela = [];

// A tabela é paginada (client-side) porque o relatório cobre o ano inteiro
// (uma linha por cliente por competência) — bem mais volume que os outros
// portais MG. Sem paginação, redesenhar todas as linhas a cada troca de
// filtro/aba deixava a página perceptivelmente lenta (usuário reportou
// 2026-08-20).
const TAMANHO_PAGINA = 100;
let paginaAtual = 1;

const el = {
  status: document.getElementById("status-execucao"),
  tipoSpedAbas: document.getElementById("tipo-sped-abas"),
  breadcrumbBar: document.getElementById("navegacao-breadcrumb"),
  breadcrumbCrumbs: document.getElementById("breadcrumb-crumbs"),
  btnVoltarPainel: document.getElementById("btn-voltar-painel"),
  placaresGrid: document.getElementById("placares-grid"),
  secaoUnidades: document.getElementById("secao-unidades"),
  unidadesGrid: document.getElementById("unidades-grid"),
  secaoDepartamentos: document.getElementById("secao-departamentos"),
  departamentosGridTitulo: document.getElementById("departamentos-grid-titulo"),
  departamentosGrid: document.getElementById("departamentos-grid"),
  corpoDashboard: document.getElementById("corpo-dashboard"),
  tabelaSecao: document.getElementById("tabela-secao"),
  busca: document.getElementById("f-busca"),
  segmento: document.getElementById("f-segmento"),
  regime: document.getElementById("f-regime"),
  competencia: document.getElementById("f-competencia"),
  status_: document.getElementById("f-status"),
  atraso: document.getElementById("f-atraso"),
  gerente: document.getElementById("f-gerente"),
  limpar: document.getElementById("f-limpar"),
  corpo: document.getElementById("tabela-corpo"),
  contagem: document.getElementById("contagem"),
  paginaAtualLabel: document.getElementById("pagina-atual"),
  paginaAnterior: document.getElementById("pagina-anterior"),
  paginaProxima: document.getElementById("pagina-proxima"),
  quebraConteudo: document.getElementById("quebra-conteudo"),
  rankingGerentes: document.getElementById("ranking-gerentes"),
  evolucaoGrafico: document.getElementById("evolucao-grafico"),
  // Filtro independente, só da tabela — não afeta KPIs/cards/ranking.
  tBusca: document.getElementById("t-busca"),
  tSegmento: document.getElementById("t-segmento"),
  tRegime: document.getElementById("t-regime"),
  tCompetencia: document.getElementById("t-competencia"),
  tStatus: document.getElementById("t-status"),
  tAtraso: document.getElementById("t-atraso"),
  tGerente: document.getElementById("t-gerente"),
  tLimpar: document.getElementById("t-limpar"),
};

function popularSelect(select, valores, formatar = (v) => v) {
  const atuais = new Set(Array.from(select.options).map((o) => o.value));
  [...valores].sort((a, b) => a.localeCompare(b, "pt-BR")).forEach((valor) => {
    if (!atuais.has(valor)) {
      const opt = document.createElement("option");
      opt.value = valor;
      opt.textContent = formatar(valor);
      select.appendChild(opt);
    }
  });
}

// Igual a popularSelect, mas limpa as opções antigas primeiro (mantendo só o
// placeholder "Todos"/"Todas", sempre a primeira <option>) — usado ao trocar
// de Tipo SPED / Unidade / Departamento, já que os valores possíveis de cada
// filtro mudam de um escopo pro outro.
function repopularSelect(select, valores, formatar = (v) => v) {
  const placeholder = select.options[0];
  select.innerHTML = "";
  select.appendChild(placeholder);
  popularSelect(select, valores, formatar);
}

// Unidade e Departamento não são mais filtros — a navegação em telas
// (escopo) já recorta os dados por eles. Sobram: busca, Segmento, Regime,
// Competência, Status, Atraso, Gerente.
function filtrarConjunto(conjunto, campos) {
  const busca = campos.busca.value.trim().toLowerCase();
  const segmento = campos.segmento.value;
  const regime = campos.regime.value;
  const competencia = campos.competencia.value;
  const status = campos.status.value;
  const atraso = campos.atraso.value;
  const gerente = campos.gerente.value;

  return conjunto.filter((r) => {
    if (segmento && r.Segmento !== segmento) return false;
    if (regime && r.RegimeTributario !== regime) return false;
    if (competencia && (!r.Competencia || !r.Competencia.startsWith(competencia))) return false;
    if (gerente && r.GerenteDeContas !== gerente) return false;
    if (status && r.Status !== status) return false;
    if (atraso && r.Atrasado !== atraso) return false;
    if (busca) {
      const alvo = `${r.Cliente || ""} ${r.Grupo || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

function aplicarFiltros() {
  filtrados = filtrarConjunto(dadosEscopo, {
    busca: el.busca, segmento: el.segmento, regime: el.regime,
    competencia: el.competencia, status: el.status_, atraso: el.atraso, gerente: el.gerente,
  });

  renderizarQuebras();
  renderizarRankingGerentes();
  renderizarEvolucao();
}

function aplicarFiltroTabela() {
  filtradosTabela = filtrarConjunto(dadosEscopo, {
    busca: el.tBusca, segmento: el.tSegmento, regime: el.tRegime,
    competencia: el.tCompetencia, status: el.tStatus, atraso: el.tAtraso, gerente: el.tGerente,
  });
  paginaAtual = 1;
  renderizarTabela();
}

const ORDEM_STATUS = ["Entregue", "Pendente"];
// Ordem fixa dentro de cada card — junto com ORDEM_STATUS acima, garante que
// todo card renderize o mesmo número de linhas (mesmo tamanho), com contagem
// 0 pro que não ocorre naquele grupo.
const ORDEM_ATRASO = ["No Prazo", "Atrasado"];

function criarContadorAtraso() {
  const atraso = new Map();
  ORDEM_ATRASO.forEach((a) => atraso.set(a, 0));
  return { total: 0, atraso };
}

function criarContadorStatus() {
  const status = new Map();
  ORDEM_STATUS.forEach((s) => status.set(s, criarContadorAtraso()));
  return status;
}

function contarDetalhado(rows, chave) {
  const grupos = new Map();
  rows.forEach((r) => {
    const valor = r[chave];
    if (!valor) return;
    if (!grupos.has(valor)) grupos.set(valor, { total: 0, status: criarContadorStatus() });
    const g = grupos.get(valor);
    g.total++;

    const status = r.Status || "Pendente";
    if (!g.status.has(status)) g.status.set(status, criarContadorAtraso());
    const s = g.status.get(status);
    s.total++;

    const atraso = r.Atrasado || "No Prazo";
    s.atraso.set(atraso, (s.atraso.get(atraso) || 0) + 1);
  });
  return [...grupos.entries()].sort((a, b) => b[1].total - a[1].total);
}

function formatarPct(n) {
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

// ── Cards totalizadores clicáveis ("tabela dinâmica") ───────────────────
// Cada dimensão mostrada nos cards (Regime, Status, Atraso, Gerente) pode
// ser clicada pra filtrar a tabela pelos registros daquele valor —
// sincroniza o filtro geral (que já alimentava só os KPIs/cards) com o
// filtro correspondente da tabela e rola a tela até ela. Mesmo mecanismo do
// Controle de Fechamentos.
const CAMPO_PARA_FILTROS = {
  Segmento: () => [el.segmento, el.tSegmento],
  RegimeTributario: () => [el.regime, el.tRegime],
  Competencia: () => [el.competencia, el.tCompetencia],
  Status: () => [el.status_, el.tStatus],
  Atrasado: () => [el.atraso, el.tAtraso],
  GerenteDeContas: () => [el.gerente, el.tGerente],
};

// Clicar em qualquer card/linha SEMPRE limpa os outros filtros gerais antes
// de aplicar o(s) campo(s) daquele clique — comportamento único e previsível
// (mesma decisão do Controle de Fechamentos). O filtro da TABELA é sempre
// sincronizado por inteiro com o geral logo em seguida, nunca só o(s)
// campo(s) do clique, pra nenhum filtro "esquecido" de um clique anterior
// ficar combinado por engano com o novo.
function sincronizarFiltroTabelaComGeral() {
  el.tBusca.value = el.busca.value;
  el.tSegmento.value = el.segmento.value;
  el.tRegime.value = el.regime.value;
  el.tCompetencia.value = el.competencia.value;
  el.tStatus.value = el.status_.value;
  el.tAtraso.value = el.atraso.value;
  el.tGerente.value = el.gerente.value;
}

function alternarFiltroEMostrarTabela(campo, valor) {
  const [geralEl] = CAMPO_PARA_FILTROS[campo]();
  const estavaAtivo = geralEl.value === valor;
  limparFiltrosGerais();
  if (!estavaAtivo) {
    CAMPO_PARA_FILTROS[campo]()[0].value = valor;
  }
  sincronizarFiltroTabelaComGeral();
  aplicarFiltros();
  aplicarFiltroTabela();
  el.tabelaSecao.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Igual a alternarFiltroEMostrarTabela, mas fixa (ou desliga, se já estava
// ativa a combinação inteira — mesmo toggle) vários campos de uma vez — hoje
// só o ranking por Gerente usa (combina Gerente + Status=Pendente, já que o
// número mostrado ali é só as pendências do gerente).
function filtrarPorVariosEMostrarTabela(pares) {
  const jaEstavaAtivo = pares.every(([campo, valor]) => CAMPO_PARA_FILTROS[campo]()[0].value === valor);
  limparFiltrosGerais();
  if (!jaEstavaAtivo) {
    pares.forEach(([campo, valor]) => {
      CAMPO_PARA_FILTROS[campo]()[0].value = valor;
    });
  }
  sincronizarFiltroTabelaComGeral();
  aplicarFiltros();
  aplicarFiltroTabela();
  el.tabelaSecao.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Detalhamento de Status (Entregue/Pendente) dentro de um card — cada linha
// abre o Atraso (No Prazo/Atrasado). Sem handler de clique próprio: o clique
// é sempre do card inteiro (ver quem chama).
function renderizarStatusGrupo(statusNome, s, totalCategoria) {
  const classe = statusNome === "Entregue" ? "recebida" : "pendente";
  const pctStatus = totalCategoria ? (s.total / totalCategoria) * 100 : 0;
  const atrasoOrdenado = ORDEM_ATRASO.map((a) => [a, s.atraso.get(a) || 0]);

  const linhasAtraso = atrasoOrdenado
    .map(([atraso, count]) => {
      const pctAtraso = totalCategoria ? (count / totalCategoria) * 100 : 0;
      return `
        <div class="status-linha">
          <span class="status-nome" title="${atraso}">${atraso}</span>
          <span class="status-valores"><b>${count.toLocaleString("pt-BR")}</b><span class="status-pct">${formatarPct(pctAtraso)}</span></span>
        </div>
      `;
    })
    .join("");

  return `
    <div class="doc-grupo ${classe}">
      <div class="doc-cabecalho">
        <span class="doc-rotulo"><i class="ponto ${classe}"></i>${statusNome}</span>
        <span class="doc-valores"><b>${s.total.toLocaleString("pt-BR")}</b><span class="doc-pct">${formatarPct(pctStatus)}</span></span>
      </div>
      <div class="status-lista">${linhasAtraso}</div>
    </div>
  `;
}

// ── Navegação: cards de Unidade e de Departamento ──────────────────────
// Ordem fixa das unidades (pedido do usuário no Controle de Fechamentos,
// 2026-08-25) — não alfabética. Unidade fora desta lista vai pro final, em
// ordem alfabética. Grafia bate exata com o dado bruto ("Santos" vem assim,
// as outras 3 em caixa alta).
const ORDEM_UNIDADES = ["SP", "RJ", "Santos", "GOIAS"];

const NOME_COMPLETO_UNIDADE = {
  SP: "São Paulo",
  RJ: "Rio de Janeiro",
  Santos: "Santos",
  GOIAS: "Goiás",
};

function nomeCompletoUnidade(sigla) {
  return NOME_COMPLETO_UNIDADE[sigla] || sigla;
}

// Tela 1 (Painel de Controle) — cards simples, só o nome da unidade e um
// rodapé fixo, sem número/estatística.
function renderizarCardsUnidades(container, rows, aoClicar) {
  const unidades = [...new Set(rows.map((r) => r.Unidade).filter(Boolean))].sort((a, b) => {
    const ia = ORDEM_UNIDADES.indexOf(a);
    const ib = ORDEM_UNIDADES.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b, "pt-BR");
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  if (!unidades.length) {
    container.innerHTML = `<p class="evolucao-vazio">Nenhuma unidade com dados para este tipo de SPED.</p>`;
    return;
  }
  container.innerHTML = unidades
    .map((nome) => `
      <div class="unidade-card" data-valor="${nome.replace(/"/g, "&quot;")}">
        <div class="unidade-card-nome">${nomeCompletoUnidade(nome)}</div>
        <div class="unidade-card-footer">Clique para ver os detalhes</div>
      </div>
    `)
    .join("");

  container.querySelectorAll(".unidade-card").forEach((cardEl) => {
    cardEl.addEventListener("click", () => aoClicar(cardEl.dataset.valor));
  });
}

// Tela 2 (grid "Por Departamento") — reaproveita a aparência do quebra-card
// (com o detalhamento de Status pronto em renderizarStatusGrupo), só que o
// clique no card inteiro navega pra tela do Departamento em vez de filtrar.
function renderizarCardsNavegacao(container, rows, chave, aoClicar, mensagemVazio, formatarNome = (v) => v) {
  const grupos = contarDetalhado(rows, chave);
  if (!grupos.length) {
    container.innerHTML = `<p class="evolucao-vazio">${mensagemVazio}</p>`;
    return;
  }
  container.innerHTML = grupos
    .map(([nome, g]) => {
      const statusHtml = ORDEM_STATUS
        .map((statusNome) => renderizarStatusGrupo(statusNome, g.status.get(statusNome), g.total))
        .join("");
      return `
        <div class="quebra-card nav-card" data-valor="${nome.replace(/"/g, "&quot;")}" title="${nome}">
          <div class="quebra-cabecalho">
            <div class="quebra-nome">${formatarNome(nome)}</div>
            <div class="quebra-total-num">${g.total.toLocaleString("pt-BR")}</div>
          </div>
          <div class="quebra-docs">${statusHtml}</div>
          <div class="nav-card-footer">Clique para ver os detalhes</div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".nav-card").forEach((cardEl) => {
    cardEl.addEventListener("click", () => aoClicar(cardEl.dataset.valor));
  });
}

// ── Cards totalizadores (placares) — topo da tela de Unidade/Departamento,
// mesma identidade visual do Controle de Fechamentos. Reflete sempre o
// escopo atual (unidade inteira, ou já recortado por departamento).
//
// 4 placares: Total / Entregue / Pendente / Atrasadas. `Entregue + Pendente =
// Total` (as 2 abas do export). "Atrasadas" aqui NÃO é o total de atrasados
// da base (esse cruza Entregue/Pendente — a maioria já foi entregue, só que
// fora do prazo, e um "Atrasado: 4.145" dava impressão errada de 4 mil
// problemas em aberto); é só o subconjunto acionável: pendente E já passou do
// vencimento. Clicáveis (filtram a tabela): Pendente e Atrasadas.
function renderizarPlacares(rows) {
  let entregue = 0;
  let pendente = 0;
  let atrasadas = 0;
  rows.forEach((r) => {
    if (r.Status === "Entregue") entregue++;
    else if (r.Status === "Pendente") {
      pendente++;
      if (r.Atrasado === "Atrasado") atrasadas++;
    }
  });
  const total = rows.length;
  // Arredondamento "honesto": só mostra 0%/100% quando for exatamente isso —
  // um valor pequeno mas não-zero nunca aparece como "0%", e um valor quase
  // igual ao teto nunca aparece como "100%" sem ser exato.
  const pctDe = (v, base, sufixo) => {
    if (!base || v === 0) return `0% ${sufixo}`;
    if (v === base) return `100% ${sufixo}`;
    const arredondado = Math.min(99, Math.max(1, Math.round((v / base) * 100)));
    return `${arredondado}% ${sufixo}`;
  };
  const escopoDesc = escopo.depto ? "do departamento" : "da unidade";

  const defs = [
    { classe: "total", valor: total, label: "Total de SPEDs", desc: escopoDesc, clicavel: false },
    { classe: "entregue", valor: entregue, label: "Entregue", desc: pctDe(entregue, total, "do total"), clicavel: false },
    {
      classe: "pendente", valor: pendente, label: "Pendente", desc: pctDe(pendente, total, "do total"),
      clicavel: true, pares: [["Status", "Pendente"]],
    },
    {
      classe: "atrasadas", valor: atrasadas, label: "Atrasadas", desc: pctDe(atrasadas, pendente, "das pendentes"),
      clicavel: true, pares: [["Status", "Pendente"], ["Atrasado", "Atrasado"]],
    },
  ];

  el.placaresGrid.innerHTML = defs.map((p) => `
    <div class="placar ${p.classe}${p.clicavel ? " placar-clicavel" : ""}"
      ${p.clicavel ? `data-pares="${JSON.stringify(p.pares).replace(/"/g, "&quot;")}"` : ""}>
      <div class="placar-label">${p.label}</div>
      <div class="placar-valor">${p.valor.toLocaleString("pt-BR")}</div>
      <div class="placar-desc">${p.desc}</div>
    </div>
  `).join("");

  el.placaresGrid.querySelectorAll(".placar-clicavel").forEach((cardEl) => {
    cardEl.addEventListener("click", () => filtrarPorVariosEMostrarTabela(JSON.parse(cardEl.dataset.pares)));
  });
}

function renderizarQuebraGrupo(container, campo, filtroEl) {
  const grupos = contarDetalhado(filtrados, campo);
  const selecionado = filtroEl.value;
  container.innerHTML = grupos
    .map(([nome, g]) => {
      const ativo = nome === selecionado ? " selecionado" : "";
      const statusHtml = ORDEM_STATUS
        .map((statusNome) => renderizarStatusGrupo(statusNome, g.status.get(statusNome), g.total))
        .join("");

      return `
        <div class="quebra-card${ativo}" data-campo="${campo}" data-valor="${nome.replace(/"/g, "&quot;")}" title="${nome}">
          <div class="quebra-cabecalho">
            <div class="quebra-nome">${nome}</div>
            <div class="quebra-total-num">${g.total.toLocaleString("pt-BR")}</div>
          </div>
          <div class="quebra-docs">${statusHtml}</div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".quebra-card").forEach((cardEl) => {
    cardEl.addEventListener("click", () => alternarFiltroEMostrarTabela(cardEl.dataset.campo, cardEl.dataset.valor));
  });
}

function renderizarQuebras() {
  renderizarQuebraGrupo(el.quebraConteudo, "RegimeTributario", el.regime);
}

function renderizarRankingGerentes() {
  const contagens = new Map();
  filtrados.forEach((r) => {
    const gerente = r.GerenteDeContas;
    if (!gerente) return;
    if (!contagens.has(gerente)) contagens.set(gerente, { total: 0, pendente: 0 });
    const c = contagens.get(gerente);
    c.total++;
    if (r.Status !== "Entregue") c.pendente++;
  });

  const lista = [...contagens.entries()]
    .filter(([, c]) => c.pendente > 0)
    .sort((a, b) => b[1].pendente - a[1].pendente)
    .slice(0, 10);

  if (!lista.length) {
    el.rankingGerentes.innerHTML = `<p style="color:var(--cinza-muted); font-size:0.85rem; margin:8px 0 0;">Nenhuma pendência no filtro atual.</p>`;
    return;
  }

  const maior = Math.max(...lista.map(([, c]) => c.pendente));
  const selecionado = el.gerente.value;

  el.rankingGerentes.innerHTML = lista
    .map(([nome, c]) => {
      const largura = (c.pendente / maior) * 100;
      const ativo = nome === selecionado ? " selecionado" : "";
      return `
        <div class="ranking-linha${ativo}" data-valor="${nome.replace(/"/g, "&quot;")}" title="${nome}: ${c.pendente} de ${c.total} pendente(s)">
          <div class="ranking-rotulo">${nome}</div>
          <div class="ranking-trilha"><div class="ranking-barra" style="width:${largura}%"></div></div>
          <div class="ranking-valor">${c.pendente}</div>
        </div>
      `;
    })
    .join("");

  // O número mostrado no ranking é só as pendências do gerente (c.pendente),
  // não o total dele — o filtro precisa combinar Gerente + Status=Pendente
  // pra mostrar exatamente esse número na tabela.
  el.rankingGerentes.querySelectorAll(".ranking-linha").forEach((linhaEl) => {
    linhaEl.addEventListener("click", () => filtrarPorVariosEMostrarTabela([
      ["GerenteDeContas", linhaEl.dataset.valor],
      ["Status", "Pendente"],
    ]));
  });
}

function celula(texto) {
  return texto === null || texto === undefined || texto === "" ? "—" : texto;
}

function nomeComId(id, nome) {
  const rotuloNome = celula(nome);
  return id === null || id === undefined || id === "" ? rotuloNome : `${id} - ${rotuloNome}`;
}

function formatarCompetencia(iso) {
  if (!iso) return "—";
  const data = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return data.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
}

// Rótulo do <option> do filtro de Competência — o value do select é o
// prefixo "AAAA-MM" (comparado com startsWith em filtrarConjunto), formatado
// aqui como "MM/AAAA" pro usuário.
function formatarCompetenciaMes(anoMes) {
  const [ano, mes] = anoMes.split("-");
  return `${mes}/${ano}`;
}

function formatarDataCurta2(iso) {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR");
}

function renderizarTabela() {
  const totalPaginas = Math.max(1, Math.ceil(filtradosTabela.length / TAMANHO_PAGINA));
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  const inicio = (paginaAtual - 1) * TAMANHO_PAGINA;
  const paginaDados = filtradosTabela.slice(inicio, inicio + TAMANHO_PAGINA);

  el.corpo.innerHTML = paginaDados
    .map((r) => {
      return `
        <tr>
          <td>${nomeComId(r.IdCliente, r.Cliente)}</td>
          <td>${celula(r.Grupo)}</td>
          <td>${celula(r.Unidade ? r.Unidade.toUpperCase() : r.Unidade)}</td>
          <td>${celula(r.Segmento)}</td>
          <td>${celula(r.GerenteDeContas)}</td>
          <td>${celula(r.Departamento)}</td>
          <td>${celula(r.RegimeTributario)}</td>
          <td>${formatarCompetencia(r.Competencia)}</td>
          <td>${formatarDataCurta2(r.DataVencimento)}</td>
          <td>${celula(r.Status)}</td>
        </tr>
      `;
    })
    .join("");

  el.contagem.textContent = `${filtradosTabela.length.toLocaleString("pt-BR")} registro(s)`;
  el.paginaAtualLabel.textContent = `Página ${paginaAtual} de ${totalPaginas}`;
  el.paginaAnterior.disabled = paginaAtual <= 1;
  el.paginaProxima.disabled = paginaAtual >= totalPaginas;
}

el.paginaAnterior.addEventListener("click", () => {
  if (paginaAtual > 1) {
    paginaAtual--;
    renderizarTabela();
  }
});

el.paginaProxima.addEventListener("click", () => {
  const totalPaginas = Math.max(1, Math.ceil(filtradosTabela.length / TAMANHO_PAGINA));
  if (paginaAtual < totalPaginas) {
    paginaAtual++;
    renderizarTabela();
  }
});

function carregarStatus() {
  fetch("data/analise_sped/status.json?" + Date.now())
    .then((r) => r.json())
    .then((s) => {
      const data = new Date(s.ultima_execucao);
      el.status.textContent = `Atualizado em ${data.toLocaleString("pt-BR")}`;
    })
    .catch(() => {
      el.status.textContent = "Nenhuma execução registrada ainda.";
    });
}

const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function formatarMesCurto(anoMes) {
  const [ano, mes] = anoMes.split("-");
  return `${MESES_ABREV[Number(mes) - 1]}/${ano.slice(2)}`;
}

// Quantos SPEDs foram entregues (DataAlteracaoEstagio de quem tem
// Status === "Entregue") em cada mês — vem direto da planilha (cada linha já
// tem sua própria data), não de um histórico acumulado por execução do robô.
// Respeita os filtros ativos (mesmo conjunto `filtrados` dos cards/ranking).
// Granularidade mensal (não diária, como no Radar Fiscal) porque o período
// consultado é o ano inteiro — um gráfico por dia teria 150+ barras
// ilegíveis; por mês bate com a granularidade natural dos dados.
function contarEntregasPorMes() {
  const meses = new Map();
  filtrados.forEach((r) => {
    if (r.Status !== "Entregue" || !r.DataAlteracaoEstagio) return;
    const mes = r.DataAlteracaoEstagio.slice(0, 7);
    meses.set(mes, (meses.get(mes) || 0) + 1);
  });
  return [...meses.entries()]
    .map(([data, total]) => ({ data, total }))
    .sort((a, b) => a.data.localeCompare(b.data));
}

// Uma barra por mês (SVG desenhado à mão, sem lib externa — mesmo padrão do
// resto do portal) com o total de SPEDs entregues naquele mês.
function renderizarEvolucao() {
  const container = el.evolucaoGrafico;
  if (!container) return;

  const historico = contarEntregasPorMes();
  if (historico.length < 2) {
    container.innerHTML = `<p class="evolucao-vazio">Sem meses suficientes com entrega no filtro atual para montar o gráfico.</p>`;
    return;
  }

  // O viewBox usa a largura real (em px) do container — 1 unidade do SVG =
  // 1px real, reajustado no resize (ver listener no fim do arquivo).
  const largura = Math.max(360, Math.round(container.clientWidth || 900));
  const altura = 380;
  const margemEsq = 46, margemDir = 16, margemTopo = 26, margemBaixo = 34;
  const areaLargura = largura - margemEsq - margemDir;
  const areaAltura = altura - margemTopo - margemBaixo;

  const maiorTotal = Math.max(1, ...historico.map((h) => h.total));
  const passoX = areaLargura / historico.length;
  const larguraBarra = passoX * 0.6;

  const coordXCentro = (i) => margemEsq + i * passoX + passoX / 2;
  const alturaBarra = (valor) => (valor / maiorTotal) * areaAltura;
  const coordY = (valor) => margemTopo + areaAltura - (valor / maiorTotal) * areaAltura;

  const barras = historico
    .map((h, i) => {
      const x = coordXCentro(i) - larguraBarra / 2;
      const yBase = margemTopo + areaAltura;
      const alt = alturaBarra(h.total);
      const y = yBase - alt;
      const rotuloTotal = `<text x="${coordXCentro(i)}" y="${y - 6}" text-anchor="middle" class="evolucao-rotulo-total">${h.total.toLocaleString("pt-BR")}</text>`;
      return `
        <rect x="${x}" y="${y}" width="${larguraBarra}" height="${alt}" class="evolucao-barra">
          <title>${formatarMesCurto(h.data)} — ${h.total.toLocaleString("pt-BR")} entregue(s)</title>
        </rect>
        ${rotuloTotal}
      `;
    })
    .join("");

  const NUM_GRADES = 4;
  const grades = Array.from({ length: NUM_GRADES + 1 }, (_, i) => {
    const valor = Math.round((maiorTotal / NUM_GRADES) * i);
    const y = coordY(valor);
    return `
      <line x1="${margemEsq}" y1="${y}" x2="${largura - margemDir}" y2="${y}" class="evolucao-grade" />
      <text x="${margemEsq - 8}" y="${y + 4}" text-anchor="end" class="evolucao-eixo-texto">${valor.toLocaleString("pt-BR")}</text>
    `;
  }).join("");

  const rotulosX = historico
    .map((h, i) => `<text x="${coordXCentro(i)}" y="${altura - margemBaixo + 18}" text-anchor="middle" class="evolucao-eixo-texto">${formatarMesCurto(h.data)}</text>`)
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${largura} ${altura}" class="evolucao-svg" role="img" aria-label="SPEDs entregues por mês">
      ${grades}
      ${barras}
      ${rotulosX}
    </svg>
  `;
}

// ── Navegação Unidade -> Departamento ──────────────────────────────────
function irParaTelaUnidades() {
  escopo = { unidade: null, depto: null };
  atualizarNavegacao();
}

function irParaUnidadeConsolidado() {
  escopo.depto = null;
  atualizarNavegacao();
}

function selecionarUnidade(unidade) {
  escopo = { unidade, depto: null };
  atualizarNavegacao();
}

function selecionarDepartamento(depto) {
  escopo.depto = depto;
  atualizarNavegacao();
}

// Botão "Voltar" — volta 1 nível por vez (departamento -> unidade -> painel
// de unidades), não pula direto pro painel igual o crumb "Painel de
// Unidades" do breadcrumb.
function voltarUmaSecao() {
  if (escopo.depto) irParaUnidadeConsolidado();
  else irParaTelaUnidades();
}

function renderizarBreadcrumb() {
  const partes = [{ texto: "Painel de Unidades", acao: irParaTelaUnidades }];
  if (escopo.unidade) partes.push({ texto: nomeCompletoUnidade(escopo.unidade), acao: irParaUnidadeConsolidado });
  if (escopo.depto) partes.push({ texto: escopo.depto, acao: null });

  el.breadcrumbCrumbs.innerHTML = partes
    .map((p, i) => {
      if (i === partes.length - 1) return `<span class="crumb-atual">${p.texto}</span>`;
      return `<span class="crumb-link" data-i="${i}">${p.texto}</span><span class="crumb-sep">›</span>`;
    })
    .join("");

  el.breadcrumbCrumbs.querySelectorAll(".crumb-link").forEach((crumbEl) => {
    crumbEl.addEventListener("click", () => partes[Number(crumbEl.dataset.i)].acao());
  });

  el.breadcrumbBar.classList.toggle("oculto", !escopo.unidade);
}

function calcularDadosEscopo() {
  return dadosTipo.filter((r) => {
    if (escopo.unidade && r.Unidade !== escopo.unidade) return false;
    if (escopo.depto && r.Departamento !== escopo.depto) return false;
    return true;
  });
}

function limparFiltrosGerais() {
  el.busca.value = "";
  el.segmento.value = "";
  el.regime.value = "";
  el.competencia.value = "";
  el.status_.value = "";
  el.atraso.value = "";
  el.gerente.value = "";
}

function limparFiltrosTabela() {
  el.tBusca.value = "";
  el.tSegmento.value = "";
  el.tRegime.value = "";
  el.tCompetencia.value = "";
  el.tStatus.value = "";
  el.tAtraso.value = "";
  el.tGerente.value = "";
}

// Corpo do dashboard (Filtros, Por Regime Tributário, Evolução, Ranking,
// Filtros da tabela, Tabela) — compartilhado entre a tela da Unidade
// (consolidado) e a tela do Departamento, só muda o recorte de `dadosEscopo`.
function atualizarCorpoDashboard() {
  dadosEscopo = calcularDadosEscopo();
  renderizarPlacares(dadosEscopo);

  limparFiltrosGerais();
  limparFiltrosTabela();

  const competencias = new Set(dadosEscopo.map((r) => r.Competencia && r.Competencia.slice(0, 7)).filter(Boolean));
  repopularSelect(el.segmento, new Set(dadosEscopo.map((r) => r.Segmento).filter(Boolean)));
  repopularSelect(el.regime, new Set(dadosEscopo.map((r) => r.RegimeTributario).filter(Boolean)));
  repopularSelect(el.competencia, competencias, formatarCompetenciaMes);
  repopularSelect(el.gerente, new Set(dadosEscopo.map((r) => r.GerenteDeContas).filter(Boolean)));
  repopularSelect(el.status_, new Set(dadosEscopo.map((r) => r.Status).filter(Boolean)));
  repopularSelect(el.atraso, new Set(dadosEscopo.map((r) => r.Atrasado).filter(Boolean)));
  repopularSelect(el.tSegmento, new Set(dadosEscopo.map((r) => r.Segmento).filter(Boolean)));
  repopularSelect(el.tRegime, new Set(dadosEscopo.map((r) => r.RegimeTributario).filter(Boolean)));
  repopularSelect(el.tCompetencia, competencias, formatarCompetenciaMes);
  repopularSelect(el.tGerente, new Set(dadosEscopo.map((r) => r.GerenteDeContas).filter(Boolean)));
  repopularSelect(el.tStatus, new Set(dadosEscopo.map((r) => r.Status).filter(Boolean)));
  repopularSelect(el.tAtraso, new Set(dadosEscopo.map((r) => r.Atrasado).filter(Boolean)));

  aplicarFiltros();
  aplicarFiltroTabela();
}

function atualizarNavegacao() {
  renderizarBreadcrumb();

  const telaUnidades = !escopo.unidade;
  const telaDepartamentoGrid = !!escopo.unidade && !escopo.depto;
  const corpoVisivel = !!escopo.unidade;

  el.secaoUnidades.classList.toggle("oculto", !telaUnidades);
  el.secaoDepartamentos.classList.toggle("oculto", !telaDepartamentoGrid);
  el.corpoDashboard.classList.toggle("oculto", !corpoVisivel);
  el.btnVoltarPainel.classList.toggle("oculto", !corpoVisivel);
  el.placaresGrid.classList.toggle("oculto", !corpoVisivel);

  if (telaUnidades) {
    renderizarCardsUnidades(el.unidadesGrid, dadosTipo, selecionarUnidade);
    return;
  }

  if (telaDepartamentoGrid) {
    const rowsUnidade = dadosTipo.filter((r) => r.Unidade === escopo.unidade);
    renderizarCardsNavegacao(
      el.departamentosGrid, rowsUnidade, "Departamento", selecionarDepartamento,
      "Nenhum registro para esta unidade."
    );
  }

  atualizarCorpoDashboard();
}

// ICMS e Contribuições são dois relatórios diferentes (regras de vencimento
// diferentes) — a pedido do usuário (2026-08-20), a página inteira sempre
// mostra só um tipo por vez, escolhido nessa aba no topo. Trocar de aba
// volta pra tela de Unidades e reseta os filtros.
const ORDEM_TIPO_SPED = ["ICMS", "Contribuições"];

function renderizarTipoSpedAbas(tipos) {
  const ordenados = [...tipos].sort((a, b) => {
    const ia = ORDEM_TIPO_SPED.indexOf(a);
    const ib = ORDEM_TIPO_SPED.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b, "pt-BR");
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  el.tipoSpedAbas.innerHTML = ordenados
    .map((tipo) => `<button type="button" class="tipo-sped-aba" data-valor="${tipo.replace(/"/g, "&quot;")}" role="tab">${tipo}</button>`)
    .join("");

  el.tipoSpedAbas.querySelectorAll(".tipo-sped-aba").forEach((botao) => {
    botao.addEventListener("click", () => {
      if (botao.dataset.valor !== tipoSpedAtivo) selecionarTipoSped(botao.dataset.valor);
    });
  });

  return ordenados;
}

function selecionarTipoSped(tipo) {
  tipoSpedAtivo = tipo;
  dadosTipo = dados.filter((r) => r.TipoSped === tipo);

  el.tipoSpedAbas.querySelectorAll(".tipo-sped-aba").forEach((botao) => {
    const ativo = botao.dataset.valor === tipo;
    botao.classList.toggle("ativa", ativo);
    botao.setAttribute("aria-selected", ativo ? "true" : "false");
  });

  // Trocar de Tipo SPED volta pra tela de Unidades — evita manter
  // selecionada uma Unidade/Departamento que pode não existir no outro tipo.
  escopo = { unidade: null, depto: null };
  atualizarNavegacao();
}

const UNIDADES_EXCLUIDAS = ["MG EXPRESS"];
// Departamento excluído a pedido do usuário (2026-08-20) — não deve aparecer
// em nenhum filtro, card, ranking, evolução ou tabela do portal.
const DEPARTAMENTOS_EXCLUIDOS = ["MG - SANTOS"];

function carregarDados() {
  fetch("data/analise_sped/analise_sped_dados.json?" + Date.now())
    .then((r) => r.json())
    .then((json) => {
      dados = json.filter((r) => !UNIDADES_EXCLUIDAS.includes(r.Unidade) && !DEPARTAMENTOS_EXCLUIDOS.includes(r.Departamento));
      if (!dados.length) {
        el.unidadesGrid.innerHTML = `<p class="evolucao-vazio">Nenhum dado exportado ainda — rode o robô (backend/orquestrador.py).</p>`;
        return;
      }
      const tipos = renderizarTipoSpedAbas([...new Set(dados.map((r) => r.TipoSped).filter(Boolean))]);
      selecionarTipoSped(tipos[0] || null);
    })
    .catch(() => {
      el.unidadesGrid.innerHTML = `<p class="evolucao-vazio">Nenhum dado exportado ainda — rode o robô (backend/orquestrador.py).</p>`;
    });
}

[el.busca, el.segmento, el.regime, el.competencia, el.status_, el.atraso, el.gerente].forEach((campo) => {
  campo.addEventListener("input", aplicarFiltros);
  campo.addEventListener("change", aplicarFiltros);
});

el.limpar.addEventListener("click", () => {
  limparFiltrosGerais();
  aplicarFiltros();
});

[el.tBusca, el.tSegmento, el.tRegime, el.tCompetencia, el.tStatus, el.tAtraso, el.tGerente].forEach((campo) => {
  campo.addEventListener("input", aplicarFiltroTabela);
  campo.addEventListener("change", aplicarFiltroTabela);
});

el.tLimpar.addEventListener("click", () => {
  limparFiltrosTabela();
  aplicarFiltroTabela();
});

const elBtnTema = document.getElementById("btn-tema");
elBtnTema.addEventListener("click", () => {
  const escuro = document.body.classList.toggle("tema-escuro");
  elBtnTema.textContent = escuro ? "Alterar tema para Claro" : "Alterar tema para Escuro";
});

el.btnVoltarPainel.addEventListener("click", voltarUmaSecao);

// Re-renderiza "Evolução Mensal" quando a largura do container muda (ex.:
// redimensionar a janela) — o viewBox do gráfico é calculado a partir da
// largura real do container, então precisa recalcular pra manter 1 unidade
// do SVG = 1px real.
let resizeTimeout;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(renderizarEvolucao, 200);
});

carregarStatus();
carregarDados();
