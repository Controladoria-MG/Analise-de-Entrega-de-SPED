"""Junta os dois relatórios brutos de SPED (ICMS + Contribuições) num único
resumo.xlsx, aplicando a mesma limpeza de Regime Tributário já usada no
[[project_radar_fiscal]]/[[project_analise_balanco]] (MAPA_REGIME) e
calculando atraso.

Cada arquivo bruto (`sped_icms.xlsx`/`sped_contribuicoes.xlsx`) tem duas
abas confirmadas em teste real (2026-08-20): `BaseSPEDPedente` (obrigações
ainda pendentes) e `BaseSPEDOk` (já entregues) — mesmas 27 colunas em
ambas. Aqui elas viram uma coluna `Status` ("Pendente"/"Entregue") e os dois
arquivos ganham `TipoSped` ("ICMS"/"Contribuições"). A coluna `Estagio`
(estágio granular da obrigação no MG Controle, ex. "19 - Arquivo não
recebido") passa adiante só limpando a classificação redundante entre
parênteses no fim.

Regra de atraso: `DataVencimento` já vem calculada pelo próprio MG Controle
(ICMS = competência + 1 mês; Contribuições = competência + 2 meses — regra
informada pelo usuário, não recalculada aqui pois o sistema já entrega a
data pronta). Para quem já entregou, a data de referência é
`DataAlteracaoEstagio` (quando a obrigação mudou pro estágio "OK"); para
quem ainda está pendente, é hoje. `Atrasado` = "Atrasado" se a data de
referência é posterior ao vencimento, senão "No Prazo".
"""

import re
from datetime import date
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).parent.parent
PASTA_DADOS = RAIZ / "data" / "analise_sped"

ARQUIVOS_BRUTOS = {
    "ICMS": PASTA_DADOS / "sped_icms.xlsx",
    "Contribuições": PASTA_DADOS / "sped_contribuicoes.xlsx",
}
ARQUIVO_RESUMO = PASTA_DADOS / "resumo.xlsx"

# Mesma limpeza usada no Radar Fiscal/Análise de Balanço (ver
# [[project_radar_fiscal]], seção "Regra de negócio do Resumo").
MAPA_REGIME = {
    "Federal - L Real -Trimestral": "Lucro Real",
    "Federal - L.Real - Mensal": "Lucro Real",
    "Federal - Lucro Real - Anual": "Lucro Real",
    "Federal - Lucro Presumido": "Lucro Presumido",
    "Federal - SN": "Simples Nacional",
    "Federal - Imune": "Imune",
}


def _limpar_regime(valor):
    if pd.isna(valor):
        return valor
    if valor in MAPA_REGIME:
        return MAPA_REGIME[valor]
    return str(valor).replace("Federal - ", "").replace("Federal -", "")


# O `Estagio` bruto vem como "19 - Arquivo não recebido (Arquivo não
# transmitido)" — a parte entre parênteses no fim é uma classificação
# agregada (transmitido / não transmitido) que já está coberta pelo Status
# (Entregue/Pendente). Mantém só o número + nome do estágio.
_RE_ESTAGIO_PARENTESES = re.compile(r"\s*\([^()]*\)\s*$")


def _limpar_estagio(valor):
    if pd.isna(valor):
        return valor
    return _RE_ESTAGIO_PARENTESES.sub("", str(valor)).strip()


def _ler_tipo(caminho: Path, tipo_nome: str) -> pd.DataFrame:
    abas = pd.read_excel(caminho, sheet_name=["BaseSPEDPedente", "BaseSPEDOk"])
    pendente = abas["BaseSPEDPedente"].copy()
    pendente["Status"] = "Pendente"
    entregue = abas["BaseSPEDOk"].copy()
    entregue["Status"] = "Entregue"
    df = pd.concat([pendente, entregue], ignore_index=True)
    df["TipoSped"] = tipo_nome
    return df


def gerar_resumo(log=None) -> pd.DataFrame:
    partes = []
    for tipo_nome, caminho in ARQUIVOS_BRUTOS.items():
        if not caminho.exists():
            raise FileNotFoundError(f"Arquivo bruto não encontrado: {caminho}")
        if log:
            log(f"Lendo {tipo_nome}...")
        partes.append(_ler_tipo(caminho, tipo_nome))

    df = pd.concat(partes, ignore_index=True)
    df["RegimeTributario"] = df["RegimeTributario"].apply(_limpar_regime)
    df["Estagio"] = df["Estagio"].apply(_limpar_estagio)

    hoje = pd.Timestamp(date.today())
    data_referencia = df["DataAlteracaoEstagio"].dt.normalize()
    data_referencia = data_referencia.where(df["Status"] == "Entregue", hoje)
    dias_atraso = (data_referencia - df["DataVencimento"]).dt.days.clip(lower=0)
    df["DiasAtraso"] = dias_atraso
    df["Atrasado"] = dias_atraso.apply(lambda d: "Atrasado" if d > 0 else "No Prazo")

    df.rename(columns={"RazaoSocial": "Cliente"}, inplace=True)

    if log:
        log(f"Resumo: {len(df)} registros ({df['Status'].value_counts().to_dict()})")

    ARQUIVO_RESUMO.parent.mkdir(parents=True, exist_ok=True)
    df.to_excel(ARQUIVO_RESUMO, index=False, engine="xlsxwriter")
    return df


if __name__ == "__main__":
    gerar_resumo(log=print)
