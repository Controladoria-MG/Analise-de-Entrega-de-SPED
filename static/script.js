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

// A tabela mostra todos os registros do filtro atual numa página só, com
// scroll interno (`.tabela-scroll` tem `max-height`). O volume é aceitável
// porque a tabela sempre está recortada por Unidade/Departamento
// (`dadosEscopo`) — a paginação client-side que existia antes (quando a
// tabela via o Tipo SPED inteiro, ~9 mil linhas) foi removida a pedido do
// usuário (2026-08-27).

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
  modalEstagio: document.getElementById("modal-estagio"),
  modalEstagioTitulo: document.getElementById("modal-estagio-titulo"),
  modalEstagioSub: document.getElementById("modal-estagio-sub"),
  modalEstagioCorpo: document.getElementById("modal-estagio-corpo"),
  modalEstagioFechar: document.getElementById("modal-estagio-fechar"),
  modalBusca: document.getElementById("modal-estagio-busca"),
  modalCompetencia: document.getElementById("modal-estagio-competencia"),
  modalGerente: document.getElementById("modal-estagio-gerente"),
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
  renderizarTabela();
}

const ORDEM_STATUS = ["Entregue", "Pendente"];
// Chaves fixas do contador de atraso — sempre presentes (contagem 0 quando
// não ocorrem no grupo) pra renderizarCorpoQuebra não precisar checar null.
const ORDEM_ATRASO = ["No Prazo", "Atrasado"];

function criarContadorAtraso() {
  const atraso = new Map();
  ORDEM_ATRASO.forEach((a) => atraso.set(a, 0));
  // `estagios`: contagem por Estágio granular do MG Controle (ex. "19 -
  // Arquivo não recebido"). Só as pendências alimentam o bloco "Por que
  // está pendente" em renderizarCorpoQuebra. Conjunto de estágios não é
  // fixo, então Map sem ordem prévia.
  return { total: 0, atraso, estagios: new Map() };
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

    const estagio = r.Estagio || "—";
    s.estagios.set(estagio, (s.estagios.get(estagio) || 0) + 1);
  });
  return [...grupos.entries()].sort((a, b) => b[1].total - a[1].total);
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

function formatarPct(n) {
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

// Um bloco de Status (Entregue / Pendente) dentro de um card de quebra —
// mesma aparência do Controle de Fechamentos ([[project_relatorio_fechamentos]],
// `renderizarDocGrupo`): faixa vermelha com rótulo + total + % do grupo, e
// abaixo a sub-lista = os Estagios granulares do MG Controle (em qual estágio
// cada SPED está), maior primeiro. Vale pros DOIS blocos (pedido do usuário
// 2026-08-28: mostrar no Entregue "em qual estágio foi entregue", igual ao
// Pendente). Cada linha é clicável e abre o modal com aqueles registros
// (ver ligarCliquesMotivo) — `data-status` diz de qual bloco a linha é.
function renderizarStatusGrupo(statusNome, s, totalCategoria) {
  const classe = statusNome === "Entregue" ? "recebida" : "pendente";
  const pctGrupo = totalCategoria ? (s.total / totalCategoria) * 100 : 0;
  const pctDe = (n) => (totalCategoria ? (n / totalCategoria) * 100 : 0);

  const estagios = [...(s.estagios || new Map()).entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const linhas = estagios.length
    ? estagios
        .map(([nome, count]) => `
          <div class="status-linha status-linha-estagio" data-status="${statusNome}" data-estagio="${nome.replace(/"/g, "&quot;")}" title="${nome} — clique para ver os registros">
            <span class="status-nome">${nome}</span>
            <span class="status-valores"><b>${count.toLocaleString("pt-BR")}</b><span class="status-pct">${formatarPct(pctDe(count))}</span></span>
          </div>
        `)
        .join("")
    : `<div class="status-linha"><span class="status-nome status-nome-vazio">Nenhum</span></div>`;

  return `
    <div class="doc-grupo ${classe}">
      <div class="doc-cabecalho">
        <span class="doc-rotulo"><i class="ponto ${classe}"></i>${statusNome}</span>
        <span class="doc-valores"><b>${s.total.toLocaleString("pt-BR")}</b><span class="doc-pct">${formatarPct(pctGrupo)}</span></span>
      </div>
      <div class="status-lista">${linhas}</div>
    </div>
  `;
}

// Corpo de um card de quebra (Por Departamento / Por Regime Tributário) —
// `g` é uma entrada de contarDetalhado ({ total, status: Map }). Dois blocos
// (Entregue / Pendente), igual ao Controle de Fechamentos.
function renderizarCorpoQuebra(g) {
  return ORDEM_STATUS
    .map((statusNome) => renderizarStatusGrupo(statusNome, g.status.get(statusNome) || criarContadorAtraso(), g.total))
    .join("");
}

// ── Modal: SPEDs de um estágio ───────────────────────────────────────
// Aberto ao clicar numa linha de estágio (bloco Entregue OU Pendente) num
// card de quebra. Mostra a tabela dos registros daquele grupo
// (Departamento ou Regime) + Status + estágio, com filtro próprio (busca +
// Competência + Gerente) — independente dos filtros da página.
let modalRegistros = [];
let modalEstagioLabel = "";
let modalGrupoLabel = "";
let modalSubstantivo = "registro(s)";

function abrirModalEstagio(registros, estagio, grupoLabel, statusNome) {
  modalRegistros = registros;
  modalEstagioLabel = estagio;
  modalGrupoLabel = grupoLabel;
  modalSubstantivo =
    statusNome === "Pendente" ? "pendência(s)" : statusNome === "Entregue" ? "entrega(s)" : "registro(s)";

  el.modalEstagioTitulo.textContent = estagio;

  const competencias = new Set(
    registros.map((r) => r.Competencia && r.Competencia.slice(0, 7)).filter(Boolean)
  );
  repopularSelect(el.modalCompetencia, competencias, formatarCompetenciaMes);
  repopularSelect(el.modalGerente, new Set(registros.map((r) => r.GerenteDeContas).filter(Boolean)));
  el.modalBusca.value = "";
  el.modalCompetencia.value = "";
  el.modalGerente.value = "";

  renderizarModalTabela();

  el.modalEstagio.classList.remove("oculto");
  document.body.classList.add("modal-aberto");
  el.modalBusca.focus();
}

function renderizarModalTabela() {
  const busca = el.modalBusca.value.trim().toLowerCase();
  const competencia = el.modalCompetencia.value;
  const gerente = el.modalGerente.value;

  const filtrados = modalRegistros.filter((r) => {
    if (competencia && (!r.Competencia || !r.Competencia.startsWith(competencia))) return false;
    if (gerente && r.GerenteDeContas !== gerente) return false;
    if (busca && !`${r.Cliente || ""} ${r.Grupo || ""}`.toLowerCase().includes(busca)) return false;
    return true;
  });

  const temFiltro = busca || competencia || gerente;
  const contagem = temFiltro
    ? `${filtrados.length.toLocaleString("pt-BR")} de ${modalRegistros.length.toLocaleString("pt-BR")} ${modalSubstantivo}`
    : `${modalRegistros.length.toLocaleString("pt-BR")} ${modalSubstantivo}`;
  const partes = [modalGrupoLabel, contagem];
  if (tipoSpedAtivo) partes.push(`SPED ${tipoSpedAtivo}`);
  el.modalEstagioSub.textContent = partes.join(" · ");

  if (!filtrados.length) {
    el.modalEstagioCorpo.innerHTML = `<tr><td colspan="10" class="modal-vazio">Nenhum registro.</td></tr>`;
    return;
  }
  const ordenados = [...filtrados].sort((a, b) =>
    String(a.DataVencimento || "").localeCompare(String(b.DataVencimento || ""))
  );
  // Mesmas colunas da tabela principal — reaproveita linhaTabela().
  el.modalEstagioCorpo.innerHTML = ordenados.map(linhaTabela).join("");
}

function fecharModalEstagio() {
  el.modalEstagio.classList.add("oculto");
  document.body.classList.remove("modal-aberto");
}

// Liga o clique das linhas de estágio (sub-lista dos blocos Entregue/Pendente)
// de cada card do container: abre o modal com os SPEDs daquele Status+estágio.
// `rows` é a base do grid (dadosTipo recortado por unidade, ou `filtrados`);
// `chave` é o campo que define o grupo do card (Departamento / RegimeTributario).
// stopPropagation pra não disparar também o clique do card (navegar/filtrar).
function ligarCliquesMotivo(container, rows, chave) {
  container.querySelectorAll(".quebra-card").forEach((cardEl) => {
    const grupo = cardEl.dataset.valor;
    cardEl.querySelectorAll(".status-linha-estagio").forEach((linhaEl) => {
      linhaEl.addEventListener("click", (evento) => {
        evento.stopPropagation();
        const estagio = linhaEl.dataset.estagio;
        const status = linhaEl.dataset.status;
        const registros = rows.filter(
          (r) => r[chave] === grupo && r.Status === status && (r.Estagio || "—") === estagio
        );
        abrirModalEstagio(registros, estagio, grupo, status);
      });
    });
  });
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
// (corpo montado por renderizarCorpoQuebra), só que o clique no card inteiro
// navega pra tela do Departamento em vez de filtrar.
function renderizarCardsNavegacao(container, rows, chave, aoClicar, mensagemVazio, formatarNome = (v) => v) {
  const grupos = contarDetalhado(rows, chave);
  if (!grupos.length) {
    container.innerHTML = `<p class="evolucao-vazio">${mensagemVazio}</p>`;
    return;
  }
  container.innerHTML = grupos
    .map(([nome, g]) => `
        <div class="quebra-card nav-card" data-valor="${nome.replace(/"/g, "&quot;")}" title="${nome}">
          <div class="quebra-cabecalho">
            <div class="quebra-nome">${formatarNome(nome)}</div>
            <div class="quebra-total-num">${g.total.toLocaleString("pt-BR")}</div>
          </div>
          <div class="quebra-docs">${renderizarCorpoQuebra(g)}</div>
          <div class="nav-card-footer">Clique para ver os detalhes</div>
        </div>
      `)
    .join("");

  container.querySelectorAll(".nav-card").forEach((cardEl) => {
    cardEl.addEventListener("click", () => aoClicar(cardEl.dataset.valor));
  });
  ligarCliquesMotivo(container, rows, chave);
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
      return `
        <div class="quebra-card${ativo}" data-campo="${campo}" data-valor="${nome.replace(/"/g, "&quot;")}" title="${nome}">
          <div class="quebra-cabecalho">
            <div class="quebra-nome">${nome}</div>
            <div class="quebra-total-num">${g.total.toLocaleString("pt-BR")}</div>
          </div>
          <div class="quebra-docs">${renderizarCorpoQuebra(g)}</div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".quebra-card").forEach((cardEl) => {
    cardEl.addEventListener("click", () => alternarFiltroEMostrarTabela(cardEl.dataset.campo, cardEl.dataset.valor));
  });
  ligarCliquesMotivo(container, filtrados, campo);
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

// Usa as células pré-formatadas em carregarDados (`_cli`/`_comp`/`_venc`) —
// o resto é `celula()`, que é só string. O conteúdo vai num `<span class="cel">`
// que limita a 2 linhas (`-webkit-line-clamp`, ver CSS) — a coluna tem largura
// fixa (<colgroup> em %), então o texto quebra em até 2 linhas e o que passar
// disso é cortado; o `title` mostra o valor inteiro no hover.
function tdCel(valor) {
  const v = celula(valor);
  const t = String(v).replace(/"/g, "&quot;");
  return `<td title="${t}"><span class="cel">${v}</span></td>`;
}

function linhaTabela(r) {
  return `
    <tr>
      ${tdCel(r._cli)}
      ${tdCel(r.Grupo)}
      ${tdCel(r.Segmento)}
      ${tdCel(r.GerenteDeContas)}
      ${tdCel(r.Departamento)}
      ${tdCel(r.RegimeTributario)}
      ${tdCel(r._comp)}
      ${tdCel(r._venc)}
      ${tdCel(r.Status)}
      ${tdCel(r.Estagio)}
    </tr>
  `;
}

// Renderiza TODOS os registros do filtro (sem paginação), mas em lotes: o
// 1º lote entra na hora (aparece instantâneo) e o resto é anexado em
// `setTimeout` (não `requestAnimationFrame` — este não roda com a aba em
// segundo plano), pra não travar a thread montando milhares de <tr> de uma
// vez. `tokenRender` cancela o preenchimento em andamento se o filtro mudar
// no meio. O CSS (`content-visibility: auto` nas linhas) corta o custo de
// layout das linhas fora da viewport.
let tokenRender = 0;
const LOTE_INICIAL_TABELA = 80;
const LOTE_TABELA = 800;

function renderizarTabela() {
  const token = ++tokenRender;
  const linhas = filtradosTabela;

  el.contagem.textContent = `${linhas.length.toLocaleString("pt-BR")} registro(s)`;
  el.corpo.innerHTML = linhas.slice(0, LOTE_INICIAL_TABELA).map(linhaTabela).join("");

  if (linhas.length <= LOTE_INICIAL_TABELA) return;

  let i = LOTE_INICIAL_TABELA;
  const proximoLote = () => {
    if (token !== tokenRender) return; // filtro mudou — aborta este render
    el.corpo.insertAdjacentHTML("beforeend", linhas.slice(i, i + LOTE_TABELA).map(linhaTabela).join(""));
    i += LOTE_TABELA;
    if (i < linhas.length) setTimeout(proximoLote, 0);
  };
  setTimeout(proximoLote, 0);
}

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
      // Pré-formata as células caras da tabela UMA vez, no carregamento —
      // `formatarCompetencia`/`formatarDataCurta2` chamam `toLocaleDateString`
      // com locale, que custa ~45µs cada; refazer isso pras ~7 mil linhas a
      // cada render era o "engasgo" de ~0,8s ao entrar numa unidade grande.
      dados.forEach((r) => {
        r._cli = nomeComId(r.IdCliente, r.Cliente);
        r._comp = formatarCompetencia(r.Competencia);
        r._venc = formatarDataCurta2(r.DataVencimento);
      });
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

// Modal de estágio: fecha no X, no clique fora da caixa e no Esc.
el.modalEstagioFechar.addEventListener("click", fecharModalEstagio);
el.modalEstagio.addEventListener("click", (evento) => {
  if (evento.target === el.modalEstagio) fecharModalEstagio();
});
document.addEventListener("keydown", (evento) => {
  if (evento.key === "Escape" && !el.modalEstagio.classList.contains("oculto")) fecharModalEstagio();
});
[el.modalBusca, el.modalCompetencia, el.modalGerente].forEach((campo) => {
  campo.addEventListener("input", renderizarModalTabela);
  campo.addEventListener("change", renderizarModalTabela);
});

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
