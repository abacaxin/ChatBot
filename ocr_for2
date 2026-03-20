const Tesseract = require("tesseract.js");
const StringSimilarity = require("string-similarity");

const nome = "Coutinho_77";

async function readD(caminhoImagem) {
	const { data: { text } } = await Tesseract.recognize(
		caminhoImagem,
		"eng"
	); 


    const tempo = text.match(/\d{2}:\d{2}\.\d{3}/g);

    return tempo? tempo[1] : null;
}
module.exports = { readD };
