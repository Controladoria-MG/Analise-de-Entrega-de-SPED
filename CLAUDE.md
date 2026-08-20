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
ICMS e Contribuições são dois relatórios diferentes (regras de vencimento diferentes) — **a página inteira sempre mostra só um tipo por vez**, escolhido numa aba grande no topo (`#tipo-sped-abas`, acima até dos chips de Unidade). Não existe mais um filtro "Tipo SPED" solto entre os outros filtros nem uma quebra "Por Tipo SPED" nos cards — a escolha do tipo é o contexto global da página, não mais uma dimensão de filtro como as outras.
- `static/script.js`: `dados` (JSON bruto completo) é sempre filtrado por `tipoSpedAtivo` em `dadosTipo` (`selecionarTipoSped()`) — **tudo** (chips de Unidade, selects de filtro, cards, ranking, evolução, tabela) deriva de `dadosTipo`, nunca de `dados` diretamente.
- Trocar de aba **reseta** todos os filtros (gerais e da tabela) e repopula as opções de cada `<select>` a partir só dos dados daquele tipo (`repopularSelect()`, que limpa e recria as opções — diferente de `popularSelect()`, que só adiciona) — evita manter selecionado um Departamento/Regime que pode não existir no outro tipo.
- Se um dia entrar um 3º/4º tipo SPED (o MG Controle também tem "Contábil"/"ECF" no mesmo select2 da tela, mas o robô só baixa ICMS e Contribuições — ver `backend/sped_relatorios.py`), as abas já aparecem automaticamente (`renderizarTipoSpedAbas()` lê os tipos distintos do JSON), só a ordem de exibição é fixa via `ORDEM_TIPO_SPED`.

### Dashboard (cards + evolução mensal + ranking)
`index.html` + `static/script.js` seguem a estrutura do [[project_radar_fiscal]]/[[project_analise_balanco]] (mesmo `static/style.css`, copiado de lá) **dentro do tipo SPED ativo**: chips de Unidade, filtros gerais (busca/Segmento/Regime Tributário/Departamento/Status/Atraso/Gerente de Contas), duas abas de cards ("Por Regime Tributário" e "Por Departamento", este último aninhado por Regime Tributário — mesmo papel que tinham no Radar Fiscal), ranking "Pendências por Gerente de Contas" (top 10, clicável) e "Evolução Mensal" (barra por mês de SPEDs entregues, usando `DataAlteracaoEstagio` de quem tem `Status`="Entregue" — papel equivalente à `DataConfirmacao` do Radar Fiscal).
- **Mensal, não diária (2026-08-20, correção do usuário)**: o robô sempre consulta o ano inteiro (01/01 até hoje), então uma barra por dia chegaria a 150+ barras ilegíveis — diferente do Radar Fiscal, que tem um histórico curto (~2 semanas) e por isso usa barra por dia. `contarEntregasPorMes()`/`formatarMesCurto()` em `static/script.js` agrupam por `AAAA-MM`.
- A quebra interna de cada card (antes "Documentação Recebida/Pendente" → "Status" de 5 valores no Radar Fiscal) aqui é **"Status" (Entregue/Pendente) → "Atrasado/No Prazo"** — só 2 níveis, mais simples porque o SPED não tem um pipeline de estágios tão granular quanto o Radar Fiscal para exibir em card.
- Tabela: sem coluna "Tipo SPED" (redundante — a página já está filtrada por tipo); coluna "Atraso" mostra um selo vermelho "Atrasado" ao lado do Status quando `Atrasado`="Atrasado" (`.tag-atraso` em `static/style.css`).

### Cores — regra fixa
**Nunca verde/âmbar para status.** Só rampa de vermelho MG, igual a todos os outros dashboards MG — ver [[feedback_mg_dashboards_red_only_palette]].
