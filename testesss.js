const Tesseract = require("tesseract.js");
const StringSimilarity = require("string-similarity");

const nome = "TheChildSpirit04";

async function read(caminhoImagem, nome) {
	const { data: { text } } = await Tesseract.recognize(
		caminhoImagem,
		"eng"
	); 

	const linhas = text.split("\n");

	let melhorLinha = null;
	let melhorScore = 0;

	linhas.forEach(linha => {
		const score = StringSimilarity.compareTwoStrings(
			linha.toLowerCase(),
			nome.toLowerCase()
		);
		if(score > melhorScore){
			melhorScore = score;
			melhorLinha = linha;
		}
	});

	

	if(!melhorLinha) return;

    const tempo = melhorLinha.match(/\d{2}:\d{2}\.\d{3}/);

    return tempo? tempo[0] : null;
}

module.exports = { read };