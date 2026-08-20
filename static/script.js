let dados = [];
// Subconjunto de `dados` só do Tipo SPED ativo (ver tipoSpedAtivo) — é o
// que toda a página (filtros, cards, ranking, evolução, tabela) enxerga.
// ICMS e Contribuições são relatórios diferentes (regras de vencimento
// diferentes, pedido explícito do usuário 2026-08-20 pra "tratá-los
// separados"), então nada mistura os dois ao mesmo tempo.
let dadosTipo = [];
let tipoSpedAtivo = null;
let filtrados = [];
let filtradosTabela = [];

// A tabela é paginada (client-side) porque o relatório cobre o ano inteiro
// (uma linha por cliente por competência) — bem mais volume que os outros
// portais MG (~9 mil linhas por Tipo SPED contra ~2 mil do Radar Fiscal).
// Sem paginação, redesenhar todas as linhas a cada troca de filtro/aba
// deixava a página perceptivelmente lenta (usuário reportou 2026-08-20).
const TAMANHO_PAGINA = 100;
let paginaAtual = 1;

const el = {
  status: document.getElementById("status-execucao"),
  statusRodape: document.getElementById("status-execucao-rodape"),
  tipoSpedAbas: document.getElementById("tipo-sped-abas"),
  busca: document.getElementById("f-busca"),
  // Não é um <select> — é um estado simples com um Set de valores (permite
  // marcar mais de uma unidade ao mesmo tempo). filtrarConjunto trata esse
  // campo de forma diferente do resto (ver `.valores` lá). Os botões ficam
  // soltos no topo da página (unidadeTopoLista). Mesmo padrão do
  // Radar Fiscal/Análise de Balanço.
  unidade: { valores: new Set() },
  unidadeTopoLista: document.getElementById("unidade-topo-lista"),
  segmento: document.getElementById("f-segmento"),
  regime: document.getElementById("f-regime"),
  depto: document.getElementById("f-depto"),
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
  quebraAbas: document.querySelectorAll("#quebra-abas-dimensao .quebra-aba"),
  rankingGerentes: document.getElementById("ranking-gerentes"),
  evolucaoGrafico: document.getElementById("evolucao-grafico"),
  // Filtro independente, só da tabela — não afeta KPIs/cards/ranking
  tBusca: document.getElementById("t-busca"),
  tUnidade: document.getElementById("t-unidade"),
  tSegmento: document.getElementById("t-segmento"),
  tRegime: document.getElementById("t-regime"),
  tDepto: document.getElementById("t-depto"),
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

function filtrarConjunto(conjunto, campos) {
  const busca = campos.busca.value.trim().toLowerCase();
  // Unidade aceita dois formatos: um <select> normal (.value, string única
  // — usado no filtro da tabela) ou o estado multi-seleção dos chips do
  // topo (.valores, Set — vazio = "Todas").
  const unidadeValores = campos.unidade.valores;
  const unidadeUnica = campos.unidade.value;
  const segmento = campos.segmento.value;
  const regime = campos.regime.value;
  const depto = campos.depto.value;
  const status = campos.status.value;
  const atraso = campos.atraso.value;
  const gerente = campos.gerente.value;

  return conjunto.filter((r) => {
    if (unidadeValores) {
      if (unidadeValores.size > 0 && !unidadeValores.has(r.Unidade)) return false;
    } else if (unidadeUnica && r.Unidade !== unidadeUnica) {
      return false;
    }
    if (segmento && r.Segmento !== segmento) return false;
    if (regime && r.RegimeTributario !== regime) return false;
    if (depto && r.Departamento !== depto) return false;
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
  filtrados = filtrarConjunto(dadosTipo, {
    busca: el.busca, unidade: el.unidade, segmento: el.segmento,
    regime: el.regime, depto: el.depto, status: el.status_, atraso: el.atraso, gerente: el.gerente,
  });

  renderizarQuebras();
  renderizarRankingGerentes();
  renderizarEvolucao();
  atualizarUnidadeTopoAtiva();
}

function renderizarUnidadeTopo() {
  const unidades = [...new Set(dadosTipo.map((r) => r.Unidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  el.unidadeTopoLista.innerHTML = [`<button type="button" class="unidade-topo-chip" data-valor="">Todas</button>`]
    .concat(
      unidades.map((u) => `<button type="button" class="unidade-topo-chip" data-valor="${u.replace(/"/g, "&quot;")}">${u.toUpperCase()}</button>`)
    )
    .join("");
  ativarFiltroUnidadeMultiplo();
  atualizarUnidadeTopoAtiva();
}

// Diferente de ativarFiltroClicavel (usado por Regime Tributário/
// Departamento/Gerente, que são single-select): aqui cada clique liga/
// desliga aquela unidade sem desmarcar as outras, permitindo comparar
// várias de uma vez.
// "Todas" é um caso especial que limpa a seleção inteira.
function ativarFiltroUnidadeMultiplo() {
  el.unidadeTopoLista.querySelectorAll(".unidade-topo-chip").forEach((botao) => {
    botao.addEventListener("click", () => {
      const valor = botao.dataset.valor;
      if (valor === "") {
        el.unidade.valores.clear();
      } else if (el.unidade.valores.has(valor)) {
        el.unidade.valores.delete(valor);
      } else {
        el.unidade.valores.add(valor);
      }
      aplicarFiltros();
    });
  });
}

function atualizarUnidadeTopoAtiva() {
  el.unidadeTopoLista.querySelectorAll(".unidade-topo-chip").forEach((botao) => {
    const valor = botao.dataset.valor;
    const ativo = valor === "" ? el.unidade.valores.size === 0 : el.unidade.valores.has(valor);
    botao.classList.toggle("ativo", ativo);
  });
}

function aplicarFiltroTabela() {
  filtradosTabela = filtrarConjunto(dadosTipo, {
    busca: el.tBusca, unidade: el.tUnidade, segmento: el.tSegmento,
    regime: el.tRegime, depto: el.tDepto, status: el.tStatus, atraso: el.tAtraso, gerente: el.tGerente,
  });
  paginaAtual = 1;
  renderizarTabela();
}

const ORDEM_STATUS = ["Entregue", "Pendente"];
// Ordem fixa dentro de cada card — junto com ORDEM_STATUS acima, garante
// que todo card renderize o mesmo número de linhas (mesmo tamanho), com
// contagem 0 pro que não ocorre naquele grupo (mesmo padrão do Radar
// Fiscal, só que aqui a quebra interna é só Atrasado/No Prazo em vez dos
// 5 status daquele projeto).
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

function contarDetalhado(chave) {
  const grupos = new Map();
  filtrados.forEach((r) => {
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

function ativarFiltroClicavel(elementos, filtroEl) {
  elementos.forEach((el2) => {
    el2.addEventListener("click", () => {
      const valor = el2.dataset.valor;
      filtroEl.value = filtroEl.value === valor ? "" : valor;
      aplicarFiltros();
    });
  });
}

function renderizarStatusGrupo(statusNome, s, totalCategoria) {
  const classe = statusNome === "Entregue" ? "recebida" : "pendente";
  const pctStatus = totalCategoria ? (s.total / totalCategoria) * 100 : 0;
  // Ordem fixa (não por contagem) pra todo card mostrar as mesmas linhas na
  // mesma posição — mesmo as zeradas.
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

function renderizarQuebraGrupo(container, chave, filtroEl) {
  const grupos = contarDetalhado(chave);
  const selecionado = filtroEl.value;
  container.innerHTML = grupos
    .map(([nome, g]) => {
      const ativo = nome === selecionado ? " selecionado" : "";
      const statusHtml = ORDEM_STATUS
        .map((statusNome) => renderizarStatusGrupo(statusNome, g.status.get(statusNome), g.total))
        .join("");

      return `
        <div class="quebra-card${ativo}" data-valor="${nome.replace(/"/g, "&quot;")}" title="${nome}">
          <div class="quebra-cabecalho">
            <div class="quebra-nome">${nome}</div>
            <div class="quebra-total-num">${g.total.toLocaleString("pt-BR")}</div>
          </div>
          <div class="quebra-docs">${statusHtml}</div>
        </div>
      `;
    })
    .join("");

  ativarFiltroClicavel(container.querySelectorAll(".quebra-card"), filtroEl);
}

function contarDetalhadoComSubgrupo(chavePrincipal, chaveSecundaria) {
  const grupos = new Map();
  filtrados.forEach((r) => {
    const valor1 = r[chavePrincipal];
    if (!valor1) return;
    if (!grupos.has(valor1)) grupos.set(valor1, { total: 0, sub: new Map() });
    const g = grupos.get(valor1);
    g.total++;

    const valor2 = r[chaveSecundaria] || "Sem regime";
    if (!g.sub.has(valor2)) g.sub.set(valor2, { total: 0, status: criarContadorStatus() });
    const sub = g.sub.get(valor2);
    sub.total++;

    const status = r.Status || "Pendente";
    if (!sub.status.has(status)) sub.status.set(status, criarContadorAtraso());
    const s = sub.status.get(status);
    s.total++;

    const atraso = r.Atrasado || "No Prazo";
    s.atraso.set(atraso, (s.atraso.get(atraso) || 0) + 1);
  });
  return [...grupos.entries()].sort((a, b) => b[1].total - a[1].total);
}

function renderizarSubCard(nome, s, selecionado) {
  const ativo = nome === selecionado ? " selecionado" : "";
  const statusHtml = ORDEM_STATUS
    .map((statusNome) => renderizarStatusGrupo(statusNome, s.status.get(statusNome), s.total))
    .join("");

  return `
    <div class="regime-card${ativo}" data-valor="${nome.replace(/"/g, "&quot;")}" title="${nome}">
      <div class="regime-card-cabecalho">
        <div class="regime-card-nome">${nome}</div>
        <div class="regime-card-total">${s.total.toLocaleString("pt-BR")}</div>
      </div>
      <div class="quebra-docs">${statusHtml}</div>
    </div>
  `;
}

const faixasAbertas = new Set();

// Clicar no cabeçalho do departamento só expande/recolhe (não filtra) — pra
// filtrar por departamento, usa o botão "Fixar". Card de Regime Tributário
// dentro continua filtrando (el.regime) num clique direto, igual antes.
function renderizarFaixaDepto(container, chavePrincipal, chaveSecundaria, filtroPrincipal, filtroSecundario) {
  const grupos = contarDetalhadoComSubgrupo(chavePrincipal, chaveSecundaria);
  const selecionado = filtroPrincipal.value;
  const selecionadoSub = filtroSecundario.value;
  container.innerHTML = grupos
    .map(([nome, g]) => {
      const ativo = nome === selecionado ? " selecionado" : "";
      const aberto = faixasAbertas.has(nome);
      const cardsHtml = [...g.sub.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([subNome, s]) => renderizarSubCard(subNome, s, selecionadoSub))
        .join("");

      return `
        <div class="quebra-faixa${aberto ? "" : " colapsado"}${ativo}" title="${nome}">
          <div class="quebra-faixa-cabecalho" data-valor="${nome.replace(/"/g, "&quot;")}">
            <button type="button" class="quebra-faixa-toggle" aria-label="Mostrar departamento" aria-expanded="${aberto}"><i class="seta"></i></button>
            <div class="quebra-nome">${nome}</div>
            <div class="quebra-total-num">${g.total.toLocaleString("pt-BR")}</div>
            <button type="button" class="quebra-faixa-fixar${ativo ? " fixado" : ""}" aria-label="${ativo ? "Remover filtro deste departamento" : "Filtrar por este departamento"}" title="${ativo ? "Remover filtro" : "Fixar filtro"}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M14.5 2.5a1 1 0 0 1 1.42 0l5.58 5.58a1 1 0 0 1 0 1.42l-1.3 1.3a1 1 0 0 1-1.3.1l-.5-.36-3.02 3.02.6 2.98a1 1 0 0 1-.27.92l-1.1 1.1a1 1 0 0 1-1.42 0l-3.4-3.4-5.02 5.02a1 1 0 0 1-1.42-1.42l5.02-5.02-3.4-3.4a1 1 0 0 1 0-1.42l1.1-1.1a1 1 0 0 1 .92-.27l2.98.6 3.02-3.02-.36-.5a1 1 0 0 1 .1-1.3z"/></svg>
            </button>
          </div>
          <div class="regime-cards">${cardsHtml}</div>
        </div>
      `;
    })
    .join("");

  // Mantém o funcionamento original da setinha
  function alternarAberto(cabecalho) {
    const faixa = cabecalho.closest(".quebra-faixa");
    const botaoToggle = cabecalho.querySelector(".quebra-faixa-toggle");
    const colapsado = faixa.classList.toggle("colapsado");
    const nome = cabecalho.dataset.valor;
    if (colapsado) faixasAbertas.delete(nome); else faixasAbertas.add(nome);
    botaoToggle.setAttribute("aria-expanded", String(!colapsado));
    botaoToggle.setAttribute("aria-label", colapsado ? "Mostrar departamento" : "Ocultar departamento");
  }

  container.querySelectorAll(".quebra-faixa-toggle").forEach((botao) => {
    botao.addEventListener("click", (e) => {
      e.stopPropagation();
      alternarAberto(botao.closest(".quebra-faixa-cabecalho"));
    });
  });

  // Clique no cabeçalho inteiro: só expande/recolhe (mesmo efeito da seta) —
  // diferente do card de Regime Tributário, o clique aqui não filtra, pra
  // não atrapalhar quem só quer abrir o departamento e ver os regimes dentro.
  container.querySelectorAll(".quebra-faixa-cabecalho").forEach((cabecalho) => {
    cabecalho.addEventListener("click", (e) => {
      if (e.target.closest(".quebra-faixa-fixar")) return;
      alternarAberto(cabecalho);
    });
  });

  // Botão "Fixar": único jeito de filtrar por este departamento.
  container.querySelectorAll(".quebra-faixa-fixar").forEach((botao) => {
    botao.addEventListener("click", (e) => {
      e.stopPropagation();
      const valor = botao.closest(".quebra-faixa-cabecalho").dataset.valor;
      filtroPrincipal.value = filtroPrincipal.value === valor ? "" : valor;
      aplicarFiltros();
    });
  });

  ativarFiltroClicavel(container.querySelectorAll(".regime-card"), filtroSecundario);
}

const QUEBRA_CONFIG = {
  regime: { chave: "RegimeTributario", filtroEl: () => el.regime },
  depto: { chave: "Departamento", subChave: "RegimeTributario", filtroEl: () => el.depto, subFiltroEl: () => el.regime },
};
let abaQuebraAtiva = "regime";

function renderizarQuebras() {
  const cfg = QUEBRA_CONFIG[abaQuebraAtiva];
  el.quebraConteudo.classList.toggle("quebra-grid--faixas", abaQuebraAtiva === "depto");
  if (cfg.subChave) {
    renderizarFaixaDepto(el.quebraConteudo, cfg.chave, cfg.subChave, cfg.filtroEl(), cfg.subFiltroEl());
  } else {
    renderizarQuebraGrupo(el.quebraConteudo, cfg.chave, cfg.filtroEl());
  }
}

el.quebraAbas.forEach((botao) => {
  botao.addEventListener("click", () => {
    abaQuebraAtiva = botao.dataset.aba;
    el.quebraAbas.forEach((b) => {
      const ativa = b === botao;
      b.classList.toggle("ativa", ativa);
      b.setAttribute("aria-selected", ativa ? "true" : "false");
    });
    renderizarQuebras();
  });
});

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

  ativarFiltroClicavel(el.rankingGerentes.querySelectorAll(".ranking-linha"), el.gerente);
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
          <td>${celula(r.Status)}${r.Atrasado === "Atrasado" ? ` <span class="tag-atraso">Atrasado</span>` : ""}</td>
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
      const texto = `Atualizado em ${data.toLocaleString("pt-BR")}`;
      el.status.textContent = texto;
      el.statusRodape.textContent = texto;
    })
    .catch(() => {
      el.status.textContent = "Nenhuma execução registrada ainda.";
      el.statusRodape.textContent = "Nenhuma execução registrada ainda.";
    });
}

const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function formatarMesCurto(anoMes) {
  const [ano, mes] = anoMes.split("-");
  return `${MESES_ABREV[Number(mes) - 1]}/${ano.slice(2)}`;
}

// Quantos SPEDs foram entregues (DataAlteracaoEstagio de quem tem
// Status === "Entregue") em cada mês — vem direto da planilha (cada linha
// já tem sua própria data), não de um histórico acumulado por execução do
// robô. Respeita os filtros ativos (mesmo conjunto `filtrados` dos
// cards/ranking). Granularidade mensal (não diária, como no Radar Fiscal)
// porque o período consultado é o ano inteiro (01/01 até hoje) — um
// gráfico por dia teria mais de 150 barras ilegíveis; por mês bate com a
// granularidade natural dos dados (Competência/Vencimento já são mensais).
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
// resto do portal) com o total de SPEDs entregues naquele mês. Barra (não
// linha) porque é uma contagem discreta por mês, não um total acumulado.
function renderizarEvolucao() {
  const container = el.evolucaoGrafico;
  if (!container) return;

  const historico = contarEntregasPorMes();
  if (historico.length < 2) {
    container.innerHTML = `<p class="evolucao-vazio">Sem meses suficientes com entrega no filtro atual para montar o gráfico.</p>`;
    return;
  }

  // O viewBox usa a largura real (em px) do container em vez de um valor
  // fixo — 1 unidade do SVG = 1px real, reajustado no resize (ver listener
  // no fim do arquivo).
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

// Igual a popularSelect, mas limpa as opções antigas primeiro (mantendo só
// o placeholder "Todos"/"Todas", sempre a primeira <option>) — usado ao
// trocar de Tipo SPED, já que os valores possíveis de cada filtro podem
// mudar de um relatório pro outro.
function repopularSelect(select, valores, formatar = (v) => v) {
  const placeholder = select.options[0];
  select.innerHTML = "";
  select.appendChild(placeholder);
  popularSelect(select, valores, formatar);
}

// ICMS e Contribuições são dois relatórios diferentes (regras de
// vencimento diferentes) — a pedido do usuário (2026-08-20), a página
// inteira (filtros, cards, ranking, evolução, tabela) sempre mostra só um
// tipo por vez, escolhido nessa aba no topo. Trocar de aba reseta os
// filtros (gerais e da tabela) e repopula as opções de cada select a
// partir só dos dados daquele tipo.
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

  el.busca.value = "";
  el.unidade.valores.clear();
  el.segmento.value = "";
  el.regime.value = "";
  el.depto.value = "";
  el.status_.value = "";
  el.atraso.value = "";
  el.gerente.value = "";
  el.tBusca.value = "";
  el.tUnidade.value = "";
  el.tSegmento.value = "";
  el.tRegime.value = "";
  el.tDepto.value = "";
  el.tStatus.value = "";
  el.tAtraso.value = "";
  el.tGerente.value = "";

  renderizarUnidadeTopo();
  repopularSelect(el.segmento, new Set(dadosTipo.map((r) => r.Segmento).filter(Boolean)));
  repopularSelect(el.regime, new Set(dadosTipo.map((r) => r.RegimeTributario).filter(Boolean)));
  repopularSelect(el.depto, new Set(dadosTipo.map((r) => r.Departamento).filter(Boolean)));
  repopularSelect(el.gerente, new Set(dadosTipo.map((r) => r.GerenteDeContas).filter(Boolean)));
  repopularSelect(el.status_, new Set(dadosTipo.map((r) => r.Status).filter(Boolean)));
  repopularSelect(el.atraso, new Set(dadosTipo.map((r) => r.Atrasado).filter(Boolean)));
  repopularSelect(el.tUnidade, new Set(dadosTipo.map((r) => r.Unidade).filter(Boolean)), (v) => v.toUpperCase());
  repopularSelect(el.tSegmento, new Set(dadosTipo.map((r) => r.Segmento).filter(Boolean)));
  repopularSelect(el.tRegime, new Set(dadosTipo.map((r) => r.RegimeTributario).filter(Boolean)));
  repopularSelect(el.tDepto, new Set(dadosTipo.map((r) => r.Departamento).filter(Boolean)));
  repopularSelect(el.tGerente, new Set(dadosTipo.map((r) => r.GerenteDeContas).filter(Boolean)));
  repopularSelect(el.tStatus, new Set(dadosTipo.map((r) => r.Status).filter(Boolean)));
  repopularSelect(el.tAtraso, new Set(dadosTipo.map((r) => r.Atrasado).filter(Boolean)));

  aplicarFiltros();
  aplicarFiltroTabela();
}

const UNIDADES_EXCLUIDAS = ["MG EXPRESS"];

function carregarDados() {
  fetch("data/analise_sped/analise_sped_dados.json?" + Date.now())
    .then((r) => r.json())
    .then((json) => {
      dados = json.filter((r) => !UNIDADES_EXCLUIDAS.includes(r.Unidade));
      const tipos = renderizarTipoSpedAbas([...new Set(dados.map((r) => r.TipoSped).filter(Boolean))]);
      selecionarTipoSped(tipos[0] || null);
    })
    .catch(() => {
      el.corpo.innerHTML = `<tr><td colspan="11">Nenhum dado exportado ainda — rode o robô (backend/orquestrador.py).</td></tr>`;
    });
}

[el.busca, el.segmento, el.regime, el.depto, el.status_, el.atraso, el.gerente].forEach((campo) => {
  campo.addEventListener("input", aplicarFiltros);
  campo.addEventListener("change", aplicarFiltros);
});

el.limpar.addEventListener("click", () => {
  el.busca.value = "";
  el.unidade.valores.clear();
  el.segmento.value = "";
  el.regime.value = "";
  el.depto.value = "";
  el.status_.value = "";
  el.atraso.value = "";
  el.gerente.value = "";
  aplicarFiltros();
});

[el.tBusca, el.tUnidade, el.tSegmento, el.tRegime, el.tDepto, el.tStatus, el.tAtraso, el.tGerente].forEach((campo) => {
  campo.addEventListener("input", aplicarFiltroTabela);
  campo.addEventListener("change", aplicarFiltroTabela);
});

el.tLimpar.addEventListener("click", () => {
  el.tBusca.value = "";
  el.tUnidade.value = "";
  el.tSegmento.value = "";
  el.tRegime.value = "";
  el.tDepto.value = "";
  el.tStatus.value = "";
  el.tAtraso.value = "";
  el.tGerente.value = "";
  aplicarFiltroTabela();
});

const elBtnTema = document.getElementById("btn-tema");
elBtnTema.addEventListener("click", () => {
  const escuro = document.body.classList.toggle("tema-escuro");
  elBtnTema.textContent = escuro ? "Alterar tema para Claro" : "Alterar tema para Escuro";
});

// Re-renderiza "Evolução Diária" quando a largura do container muda (ex.:
// redimensionar a janela) — o viewBox do gráfico é calculado a partir da
// largura real do container (ver renderizarEvolucao), então precisa
// recalcular pra manter 1 unidade do SVG = 1px real.
let resizeTimeout;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(renderizarEvolucao, 200);
});

carregarStatus();
carregarDados();
