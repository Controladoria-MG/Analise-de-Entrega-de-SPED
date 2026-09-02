"""Orquestrador do pipeline completo — roda o robô de SPED (2 relatórios numa
única execução), junta as bases com `resumo.py` e gera os JSONs que o portal
lê via `fetch`. Ponto de entrada: `python backend/orquestrador.py`.
"""

import json
from datetime import datetime
from pathlib import Path

import pandas as pd

import resumo
import sped_relatorios

RAIZ = Path(__file__).parent.parent
PASTA_DESTINO = RAIZ / "data" / "analise_sped"
ARQUIVO_STATUS = PASTA_DESTINO / "status.json"
ARQUIVO_DADOS_PORTAL = PASTA_DESTINO / "analise_sped_dados.json"

# Subconjunto de colunas que o portal de fato usa (KPIs, cards por Tipo
# SPED/Departamento, evolução mensal, filtros e tabela) — ver
# static/script.js.
COLUNAS_PORTAL = [
    "IdCliente", "Cliente", "Grupo", "Unidade", "Segmento", "Departamento",
    "GerenteDeContas", "GerenteMaster", "RegimeTributario", "TipoSped",
    "Competencia", "DataVencimento", "DataAlteracaoEstagio", "Status",
    "Estagio", "Atrasado", "DiasAtraso",
]


def _log(msg, log=None):
    if log:
        log(msg)


def _gerar_json_portal(df: pd.DataFrame) -> None:
    """Gera um JSON enxuto (subconjunto de colunas) para o portal web ler via
    fetch — o portal não faz parsing de .xlsx no navegador."""
    subset = df[COLUNAS_PORTAL].copy()
    registros = subset.to_dict(orient="records")

    def _serializar(valor):
        # pandas usa NaN/NaT para valores ausentes mesmo em colunas de texto —
        # nenhum dos dois é JSON válido (JS trava no fetch), então vira None
        # (null) aqui. Timestamp (Competencia/DataVencimento/
        # DataAlteracaoEstagio) também não é serializável direto — vira
        # string ISO 8601.
        if pd.isna(valor):
            return None
        if isinstance(valor, pd.Timestamp):
            return valor.isoformat()
        return valor

    registros = [{chave: _serializar(valor) for chave, valor in reg.items()} for reg in registros]
    ARQUIVO_DADOS_PORTAL.write_text(
        json.dumps(registros, ensure_ascii=False, indent=None),
        encoding="utf-8",
    )


def executar(log=None) -> pd.DataFrame:
    sped_relatorios.executar(log)

    df = resumo.gerar_resumo(log)
    _log(f"Resumo: {len(df)} registros.", log)

    _gerar_json_portal(df)

    ARQUIVO_STATUS.write_text(
        json.dumps(
            {
                "ultima_execucao": datetime.now().isoformat(timespec="seconds"),
                "registros": len(df),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    _log(f"Portal atualizado: {ARQUIVO_DADOS_PORTAL} + {ARQUIVO_STATUS}", log)
    return df


if __name__ == "__main__":
    executar(log=print)
