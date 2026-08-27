# CLAUDE.md — Regras de Projeto

## Estrutura de Diretórios

```
Raiz/
├── index.html
├── .gitignore
├── .env / .env.example
├── CLAUDE.md
├── documentacao.txt
├── requirements.txt
├── static/
│   ├── script.js
│   └── style.css
├── data/
│   └── analise_sped/
└── backend/
    ├── sped_relatorios.py   (robô — Intranet MG Controle, selenium)
    ├── resumo.py            (junta as duas exportações + calcula atraso)
    └── orquestrador.py      (roda o robô + resumo.py + gera os JSONs do portal)
```

---

## Regras — OBRIGATÓRIO SEGUIR

### HTML
- O único arquivo `.html` do projeto é `index.html`, localizado **sempre na raiz**.
- **NUNCA** crie outros arquivos `.html` em subpastas.
- **NUNCA** escreva CSS ou JS inline dentro do HTML. Use os arquivos em `static/`.

### CSS e JS
- Todo `.css` e `.js` fica **exclusivamente** em `static/`.
- **NUNCA** crie subpastas dentro de `static/`.
- **NUNCA** misture lógica de backend com arquivos de `static/`.

### Dados (`data/`)
- **NUNCA** salve arquivos diretamente na raiz de `data/`.
- Todo arquivo de dados fica dentro de `data/analise_sped/`.
- Arquivos gerados:
    - `sped_icms.xlsx` / `sped_contribuicoes.xlsx`: exportações brutas do MG Controle (Relatório Gerencial > Totalizador), cada uma com 2 abas — `BaseSPEDPedente` (pendentes) e `BaseSPEDOk` (entregues), 27 colunas, sobrescritas a cada execução.
    - `resumo.xlsx`: as duas exportações unidas numa base só (`Status`="Entregue"/"Pendente", `TipoSped`="ICMS"/"Contribuições", `Atrasado`, `DiasAtraso`) — é o que o portal usa. Ver `backend/resumo.py`.
    - `analise_sped_dados.json`: subconjunto de colunas do resumo para o portal ler via `fetch`.
    - `status.json`: `{ultima_execucao, registros}`.

### Backend (`backend/`)
- `sped_relatorios.py`: automatiza a **Intranet** (`https://aplicativo.mgcontecnica.com.br/#/home`, via **selenium**) — login > tile "MG Controle" > Operacional > (Menu SPED) Relatórios > Relatório Gerencial. Numa única sessão de navegador, exporta os dois tipos (ICMS e Contribuições) filtrados de `01/01/{ano atual}` até hoje. Expõe `executar(log=None) -> dict[str, Path]`. Detalhes de navegação e seletores no docstring do próprio arquivo.
- `resumo.py`: lê as 2 abas de cada um dos 2 arquivos brutos, empilha tudo numa base só, limpa `RegimeTributario` (mesmo `MAPA_REGIME` do [[project_radar_fiscal]]) e calcula `Atrasado`/`DiasAtraso`. Expõe `gerar_resumo(log=None) -> DataFrame`.
- `orquestrador.py`: chama `sped_relatorios.executar()` + `resumo.gerar_resumo()`, gera `analise_sped_dados.json` (subconjunto `COLUNAS_PORTAL`) e `status.json`. Ponto de entrada: `python backend/orquestrador.py`.
- **Não existe backend web** — o portal é 100% estático (lê os JSONs via `fetch`), mesmo padrão dos outros portais MG.
- **NUNCA** importe ou referencie arquivos de `static/` a partir do backend.

### Regra de negócio — vencimento e atraso
- **SPED ICMS** vence no mês seguinte ao da competência (competência 07 → vence em 08).
- **SPED Contribuições** vence dois meses depois da competência (competência 07 → vence em 09).
- O próprio MG Controle já calcula e entrega `DataVencimento` pronta no export (confirmado batendo com a regra acima em teste real) — **o robô/resumo não recalculam essa data**, só a usam.
- `Atrasado` (`backend/resumo.py`): compara a data de referência (para quem já entregou, `DataAlteracaoEstagio`; para quem ainda está pendente, hoje) com `DataVencimento`. `DiasAtraso` é a diferença em dias (0 se não atrasado).

### `.gitignore`
- Inclui obrigatoriamente `.env`, `__pycache__/`, `*.log`, `.venv/`.
- Em `data/analise_sped/`: só os `.xlsx` brutos e a subpasta temporária de download (`_temp/`) são ignorados. `analise_sped_dados.json` e `status.json` são versionados — permite portal hospedado (GitHub Pages) mostrar dados atualizados a cada push, mesmo padrão do Radar Fiscal.
- **NUNCA** versione credenciais.

### Como rodar
```
cd Analise-de-Entrega-de-SPED
python backend/orquestrador.py   # roda o robô + gera os dados
python -m http.server 8793
```
Acessar `http://localhost:8793` (fetch de arquivo local via `file://` é bloqueado por CORS).

### Separação ICMS / Contribuições (2026-08-20, a pedido explícito do usuário)
ICMS e Contribuições são dois relatórios diferentes (regras de vencimento diferentes) — **a página inteira sempre mostra só um tipo por vez**, escolhido numa aba grande no topo (`#tipo-sped-abas`). Não existe um filtro "Tipo SPED" solto nem uma quebra "Por Tipo SPED" nos cards — a escolha do tipo é o contexto global da página.
- `static/script.js`: `dados` (JSON bruto completo) é sempre filtrado por `tipoSpedAtivo` em `dadosTipo` (`selecionarTipoSped()`); `dadosTipo` é então recortado pela navegação em `dadosEscopo` — **tudo** (cards de navegação, selects de filtro, cards, ranking, evolução, tabela) deriva desses, nunca de `dados` diretamente.
- Trocar de aba volta pro Painel de Unidades, **reseta** todos os filtros e repopula as opções de cada `<select>` (`repopularSelect()`).
- Se um dia entrar um 3º/4º tipo SPED (o MG Controle também tem "Contábil"/"ECF", mas o robô só baixa ICMS e Contribuições — ver `backend/sped_relatorios.py`), as abas já aparecem automaticamente (`renderizarTipoSpedAbas()` lê os tipos distintos do JSON), só a ordem é fixa via `ORDEM_TIPO_SPED`.

### Navegação Unidade → Departamento (2026-08-27, mesma cara do [[project_relatorio_fechamentos]])
Portado do Controle de Fechamentos: em vez de chips de Unidade + abas de quebra, a página tem 3 "telas" controladas por `escopo = { unidade, depto }` em `static/script.js` (`selecionarTipoSped()` reseta pra `{null, null}`):
1. **Painel de Unidades** (`escopo.unidade === null`): grid de cards, um por Unidade, só o nome — sem números. Ordem fixa `ORDEM_UNIDADES` (SP, RJ, Santos, GOIAS); nome por extenso via `NOME_COMPLETO_UNIDADE`.
2. **Tela da Unidade** (`escopo.unidade` setado, `escopo.depto === null`): placares (Total/Entregue/Pendente/Atrasado) + grid de cards "Por Departamento" pra detalhar + o corpo inteiro do dashboard já como visão consolidada da unidade.
3. **Tela do Departamento** (`escopo.depto` também setado): mesmo corpo, recortado só pra aquele departamento.

Breadcrumb preto full-width (`#navegacao-breadcrumb`, fora do `<main>`) + botão "Voltar" (volta 1 nível). `dadosEscopo` (= `dadosTipo` recortado por `escopo`, ver `calcularDadosEscopo()`) é a base do corpo do dashboard. **Unidade e Departamento saíram dos filtros** (gerais e da tabela) — a navegação já cobre. Sobram: busca, Segmento, Regime Tributário, Competência, Status, Atraso, Gerente de Contas.

### Placares (cards totalizadores, 2026-08-27)
No topo da tela de Unidade/Departamento, mesma identidade do Controle de Fechamentos: **Total de SPEDs / Entregue / Pendente / Atrasado** (`renderizarPlacares()`). "Pendente" (→ `Status="Pendente"`) e "Atrasado" (→ `Atrasado="Atrasado"`) são clicáveis e filtram a tabela; "Total" e "Entregue" não. Percentual "honesto" (nunca mostra 0%/100% sem ser exato). "Atrasado" é outra dimensão — sobrepõe Entregue/Pendente (um SPED pode ter sido entregue com atraso).

### Cards clicáveis / "tabela dinâmica" (2026-08-27, portado do Controle de Fechamentos)
Card "Por Regime Tributário" e cada linha do ranking por Gerente são clicáveis e mostram os clientes daquele valor **na tabela logo abaixo** (rolam até ela). `CAMPO_PARA_FILTROS` mapeia campo→[filtro geral, filtro tabela]. Um clique **sempre limpa os outros filtros gerais antes** (`limparFiltrosGerais()` em `alternarFiltroEMostrarTabela`/`filtrarPorVariosEMostrarTabela`) e sincroniza os 6 campos do filtro da tabela por inteiro com os gerais (`sincronizarFiltroTabelaComGeral()`). O ranking combina `GerenteDeContas` + `Status="Pendente"` (o número ali é só as pendências do gerente).

### Dashboard (cards + evolução mensal + ranking)
`index.html` + `static/script.js` seguem a estrutura do [[project_relatorio_fechamentos]] (mesmo `static/style.css`): "Por Regime Tributário" (grid único de cards, sem abas nem faixas aninhadas), ranking "Pendências por Gerente de Contas" (top 10, clicável) e "Evolução Mensal" (barra por mês de SPEDs entregues, usando `DataAlteracaoEstagio` de quem tem `Status`="Entregue").
- **Mensal, não diária (2026-08-20, correção do usuário)**: o robô sempre consulta o ano inteiro (01/01 até hoje), então uma barra por dia chegaria a 150+ barras ilegíveis. `contarEntregasPorMes()`/`formatarMesCurto()` agrupam por `AAAA-MM`.
- A quebra interna de cada card é **"Status" (Entregue/Pendente) → "Atrasado/No Prazo"** — só 2 níveis (`renderizarStatusGrupo()`).
- **Tabela paginada** (`TAMANHO_PAGINA = 100`) — o relatório cobre o ano inteiro (~9 mil linhas por tipo), volume bem maior que os outros portais MG. Sem coluna "Tipo SPED" (redundante — a página já está filtrada por tipo).

### Cores — regra fixa
**Nunca verde/âmbar para status.** Só rampa de vermelho MG, igual a todos os outros dashboards MG — ver [[feedback_mg_dashboards_red_only_palette]].
