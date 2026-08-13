// Barra com botões para baixar os CSVs de dados do experimento.
// Baixar é só apontar o navegador para a rota; o backend envia o arquivo
// com o cabeçalho de "attachment", então o navegador baixa em vez de abrir.
export function ExportBar() {
  function baixar(rota: string) {
    // Abre a URL de download numa aba efêmera; o navegador cuida do resto.
    window.open(`http://localhost:3333/export/${rota}`, "_blank");
  }

  return (
    <div className="export-bar">
      <span className="export-titulo">Exportar dados</span>
      <button className="export-btn" onClick={() => baixar("versoes.csv")}>
        ⬇ CSV detalhado (versões)
      </button>
      <button className="export-btn" onClick={() => baixar("historias.csv")}>
        ⬇ CSV resumo (histórias)
      </button>
    </div>
  );
}
