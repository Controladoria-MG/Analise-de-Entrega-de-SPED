"""Robô — Relatório Gerencial de SPED (Intranet MG Controle, selenium).

Automatiza https://aplicativo.mgcontecnica.com.br/#/home > tile "MG Controle"
> Operacional > Menu SPED > Relatórios > Relatório Gerencial para baixar,
numa única execução, os dois relatórios "Totalizador" (ICMS e Contribuições)
filtrados de 01/01/{ano atual} até hoje.

Navegação calibrada ao vivo em 2026-08-20:
- Tile "MG Controle" abre uma nova janela/aba (mesma lógica do
  [[project_analise_balanco]] retorno_checklist.py).
- "Operacional" (sidebar) é o link `ContentPlaceHolder1_BaixaObrigacaoLinkButton`
  — leva a MenuBaixaObrigacao.aspx, que tem uma seção "Menu SPED" com o tile
  "Relatórios" (`ContentPlaceHolder1_lnkSpedRelatorios`) — **não** é o mesmo
  "Relatórios" do topo do menu lateral (esse outro leva a
  Relatorio/Default.aspx > Personalizados, usado pelo retorno_checklist.py;
  são dois menus "Relatórios" diferentes dentro do MG Controle).
- A tela "Relatório Gerencial" (Sped/Relatorio/RelatorioGerencial.aspx) já
  abre com "Relatório Gerencial" selecionado por padrão. Campos: `ddlTipo`
  (select2 — ICMS/Contribuições/Contábil/ECF), `txtDataInicial`/
  `txtDataFinal` (texto livre DD/MM/AAAA, sem máscara/readonly), botão
  "Exportar" (`<a class="btn btn-darkRed pull-right">`, sem id, aciona
  `namespace.ExportarRelatorio(...)` — dispara download em background, sem
  abrir nova aba/iframe visível).
- O nome do arquivo é gerado pelo servidor: `RelatorioTotalizador_{Tipo}-
  {AAAA-MM-DD}.xlsx` (confirmado baixando o ICMS de verdade). O robô limpa a
  pasta temp antes de cada exportação e pega o único .xlsx novo que aparecer
  — não depende do texto exato do nome (evita problema de acentuação em
  "Contribuições" no nome do arquivo).
- Igual ao Radar Fiscal, roda os dois relatórios numa única sessão de
  navegador (um login/navegação só), não um robô por relatório.
"""

import os
import time
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

RAIZ = Path(__file__).parent.parent
load_dotenv(RAIZ / ".env")

URL_LOGIN = "https://aplicativo.mgcontecnica.com.br/#/home"
USUARIO = os.getenv("INTRANET_USUARIO", "")
SENHA = os.getenv("INTRANET_SENHA", "")

PASTA_DESTINO = RAIZ / "data" / "analise_sped"
PASTA_TEMP = PASTA_DESTINO / "_temp"

# Tipo SPED (texto exibido no select2) -> nome do arquivo final salvo em data/.
TIPOS_SPED = {
    "ICMS": PASTA_DESTINO / "sped_icms.xlsx",
    "Contribuições": PASTA_DESTINO / "sped_contribuicoes.xlsx",
}

TIMEOUT_PADRAO = 20
TIMEOUT_DOWNLOAD = 180


def _log(msg, log=None):
    if log:
        log(msg)


def _criar_driver(pasta_destino: Path) -> webdriver.Chrome:
    options = Options()
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-extensions")
    options.add_argument("--headless=new")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--log-level=3")
    options.add_experimental_option("excludeSwitches", ["enable-logging", "enable-automation"])
    options.add_experimental_option("prefs", {
        "download.default_directory": str(pasta_destino),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
        "safebrowsing.disable_download_protection": True,
    })
    options.add_argument("--safebrowsing-disable-download-protection")

    driver = webdriver.Chrome(options=options)
    driver.execute_cdp_cmd(
        "Page.setDownloadBehavior",
        {"behavior": "allow", "downloadPath": str(pasta_destino)},
    )
    return driver


def _limpar_pasta(pasta: Path):
    pasta.mkdir(parents=True, exist_ok=True)
    for arquivo in os.listdir(pasta):
        caminho = pasta / arquivo
        if caminho.is_file():
            caminho.unlink()


def _selecionar_tipo_sped(driver, wait, texto: str, log=None):
    _log(f"Selecionando Tipo SPED: {texto}...", log)
    wait.until(EC.element_to_be_clickable((By.ID, "s2id_ddlTipo"))).click()
    opcao = wait.until(
        EC.element_to_be_clickable(
            (By.XPATH, f"//div[@id='select2-drop']//li[contains(@class,'select2-result')]//div[normalize-space()='{texto}']")
        )
    )
    opcao.click()


def _preencher_datas(driver, wait, data_inicial: str, data_final: str, log=None):
    _log(f"Preenchendo período: {data_inicial} até {data_final}...", log)
    campo_inicio = wait.until(EC.element_to_be_clickable((By.ID, "txtDataInicial")))
    campo_fim = wait.until(EC.element_to_be_clickable((By.ID, "txtDataFinal")))
    campo_inicio.clear()
    campo_inicio.send_keys(data_inicial)
    campo_fim.clear()
    campo_fim.send_keys(data_final)
    # Fecha o calendário sobreposto que abre ao digitar na Data Final,
    # clicando fora — senão ele pode interceptar o clique no botão Exportar.
    driver.find_element(By.TAG_NAME, "body").click()


def _exportar_e_aguardar(driver, wait, pasta_temp: Path, log=None) -> Path:
    _limpar_pasta(pasta_temp)
    _log("Exportando...", log)
    # Localizado pelo onclick (chama namespace.ExportarRelatorio(...), texto
    # confirmado único na página) em vez do texto visível do botão — um
    # match por normalize-space()='Exportar' falhou em teste real (2026-08-20),
    # provavelmente por causa de um ícone/caractere extra dentro do <a> que
    # só aparece no DOM real, não na inspeção visual feita antes.
    wait.until(
        EC.element_to_be_clickable((By.XPATH, "//a[contains(@onclick,'ExportarRelatorio')]"))
    ).click()

    tempo_inicio = time.time()
    while (time.time() - tempo_inicio) < TIMEOUT_DOWNLOAD:
        arquivos = os.listdir(pasta_temp)
        if any(arq.endswith(".crdownload") for arq in arquivos):
            time.sleep(2)
            continue
        arquivos_xlsx = [f for f in arquivos if f.endswith(".xlsx")]
        if arquivos_xlsx:
            return pasta_temp / arquivos_xlsx[0]
        time.sleep(2)

    raise RuntimeError(f"Download não detectado dentro de {TIMEOUT_DOWNLOAD}s.")


def executar(log=None) -> dict[str, Path]:
    hoje = date.today()
    data_inicial = f"01/01/{hoje.year}"
    data_final = hoje.strftime("%d/%m/%Y")
    _log(f"Período: {data_inicial} até {data_final}", log)

    PASTA_DESTINO.mkdir(parents=True, exist_ok=True)
    _limpar_pasta(PASTA_TEMP)

    driver = _criar_driver(PASTA_TEMP)
    wait = WebDriverWait(driver, TIMEOUT_PADRAO)
    resultado: dict[str, Path] = {}

    try:
        _log("Abrindo Intranet...", log)
        driver.get(URL_LOGIN)
        time.sleep(2)

        _log("Fazendo login...", log)
        try:
            campo_usuario = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.ID, "usuario"))
            )
            campo_usuario.send_keys(USUARIO)
            driver.find_element(By.ID, "senha").send_keys(SENHA)
            wait.until(
                EC.element_to_be_clickable((By.XPATH, "//button[normalize-space()='Entrar']"))
            ).click()
            time.sleep(2)
        except Exception:
            pass  # já logado

        _log("Acessando MG Controle...", log)
        wait.until(
            EC.element_to_be_clickable((By.XPATH, "//h6[@title='MG Controle']"))
        ).click()
        time.sleep(3)
        driver.switch_to.window(driver.window_handles[-1])

        _log("Navegando até Operacional > Relatórios (Menu SPED)...", log)
        wait.until(
            EC.element_to_be_clickable((By.ID, "ContentPlaceHolder1_BaixaObrigacaoLinkButton"))
        ).click()
        wait.until(
            EC.element_to_be_clickable((By.ID, "ContentPlaceHolder1_lnkSpedRelatorios"))
        ).click()
        wait.until(EC.presence_of_element_located((By.ID, "ddlTipo")))

        for tipo_nome, arquivo_saida in TIPOS_SPED.items():
            _selecionar_tipo_sped(driver, wait, tipo_nome, log)
            _preencher_datas(driver, wait, data_inicial, data_final, log)
            caminho_baixado = _exportar_e_aguardar(driver, wait, PASTA_TEMP, log)

            if arquivo_saida.exists():
                arquivo_saida.unlink()
            caminho_baixado.replace(arquivo_saida)
            _limpar_pasta(PASTA_TEMP)
            resultado[tipo_nome] = arquivo_saida
            _log(f"{tipo_nome} salvo em {arquivo_saida}", log)

        return resultado

    finally:
        time.sleep(2)
        driver.quit()


if __name__ == "__main__":
    executar(log=print)
