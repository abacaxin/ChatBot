const Tesseract = require("tesseract.js");
const StringSimilarity = require("string-similarity");

async function read(caminhoImagem, nick, nomeGP) {
  const { data: { text } } = await Tesseract.recognize(caminhoImagem, "eng");
  const linhas = text.split("\n").filter(l => l.trim());

  // 1. Verifica se o nome do GP aparece na imagem
  if (nomeGP) {
    const nomeGPLower = nomeGP.toLowerCase();
    const encontrado  = linhas.some(l => l.toLowerCase().includes(nomeGPLower));
    if (!encontrado) {
      return { erro: "gp_nao_encontrado" };
    }
  }

  // 2. Acha a linha do nick e extrai o tempo
  let melhorLinha = null;
  let melhorScore = 0;

  linhas.forEach(linha => {
    const score = StringSimilarity.compareTwoStrings(linha.toLowerCase(), nick.toLowerCase());
    if (score > melhorScore) {
      melhorScore = score;
      melhorLinha = linha;
    }
  });

  if (!melhorLinha) return null;
  const tempo = melhorLinha.match(/\d{2}:\d{2}\.\d{3}/);
  return tempo ? tempo[0] : null;
}

module.exports = { read };
