# Análise sintática com spaCy, usada pela regra de atomicidade.
# A regra só deve sinalizar um "e"/"ou" que liga duas AÇÕES (verbos) ou duas
# QUALIDADES (adjetivos), e não um que liga substantivos ("título e autor").
#
# Este módulo é registrado no serviço do Whisper (whisper_service.py) como um
# Blueprint do Flask, na mesma porta 5001:
#     from analise_sintatica import bp_sintaxe
#     app.register_blueprint(bp_sintaxe)
from flask import Blueprint, request, jsonify
import spacy

bp_sintaxe = Blueprint("sintaxe", __name__)

print("Carregando o modelo de português do spaCy...")
_nlp = spacy.load("pt_core_news_sm")
print("Modelo do spaCy carregado.")

# Classes gramaticais que indicam duas histórias quando coordenadas.
CLASSES_SINALIZADAS = {"VERB", "AUX", "ADJ"}


@bp_sintaxe.route("/coordenacao", methods=["POST"])
def coordenacao():
    dados = request.get_json(silent=True) or {}
    texto = str(dados.get("texto", ""))
    doc = _nlp(texto)

    coordenacoes = []
    for tok in doc:
        # O conector ("e", "ou") é ligado ao SEGUNDO termo coordenado.
        if tok.dep_ == "cc" and tok.lower_ in ("e", "ou"):
            segundo = tok.head
            primeiro = segundo.head if segundo.dep_ == "conj" else None
            coordenacoes.append({
                "conector": tok.lower_,
                "primeiro": primeiro.text if primeiro is not None else None,
                "segundo": segundo.text,
                "classe": segundo.pos_,
                "sinalizar": segundo.pos_ in CLASSES_SINALIZADAS,
            })

    return jsonify({"coordenacoes": coordenacoes})
