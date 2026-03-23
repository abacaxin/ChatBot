const Tesseract = require("tesseract.js");
const StringSimilarity = require("string-similarity");

async function read(caminhoImagem, nick, nomeGP) {
  const { data: { text } } = await Tesseract.recognize(caminhoImagem, "eng");
  const linhas = text.split("\n").filter(l => l.trim());

  // 1. Verifica nome do GP na imagem
  if (nomeGP) {
    const melhorMatchGP = Math.max(
      ...linhas.map(l => StringSimilarity.compareTwoStrings(
        l.toLowerCase(), nomeGP.toLowerCase()
      ))
    );
    if (melhorMatchGP < 0.4) return { erro: "foto não compatível com o gp" };
  }

  // 2. Acha a linha do nick e extrai o tempo
  let melhorLinha = null;
  let melhorScore = 0;

  linhas.forEach(linha => {
    const score = StringSimilarity.compareTwoStrings(
      linha.toLowerCase(), nick.toLowerCase()
    );
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
