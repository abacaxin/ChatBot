const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const { read } = require("./ocrbot");

const ADM_IDS = [
  "77267199893514@lid",
  "174676940705846@lid"
];

const comandos = ['!menu', '!unpen', '!pen', '!tabela', '!tempo'];

const client = new Client({
  authStrategy: new LocalAuth()
});

const chatID = "120363423256823339@g.us";

const participantesFile = "participantes.json";
let registrosPendentes = {}; // controle do fluxo de registro
let edicoesPendentes = {}; // controla quem está editando
let salvando = false; // variável global no topo do arquivo


// Funções auxiliares
function carregarParticipantes() {
  if (!fs.existsSync(participantesFile)) return [];
  return JSON.parse(fs.readFileSync(participantesFile));
}

function salvarParticipantes(dados) {
  // espera se outra gravação estiver acontecendo
    while (salvando) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }

    salvando = true; // bloqueia
    fs.writeFileSync(participantesFile, JSON.stringify(dados, null, 2));
    salvando = false; // libera
}

function isAdmin(message) {
  return ADM_IDS.includes(message.author || message.from);
}

// QR
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

// Bot pronto
client.on("ready", () => {
  console.log("Bot ready");
});

// Mensagens
client.on("message", async message => {
  const id = message.author;
  const texto = message.body.trim().toLowerCase();

  // --- Registro pendente ---
  if (registrosPendentes[id]) {
    const etapa = registrosPendentes[id].etapa;
    const dados = registrosPendentes[id];

    if (etapa === "nick") {
      dados.nick = message.body.trim();
      dados.etapa = "nome";
      message.reply("Digite seu nome completo:");
      return;
    }

    if (etapa === "nome") {
      dados.nome = message.body.trim();
      dados.etapa = "equipe";
      message.reply("Digite sua equipe:");
      return;
    }

    if (etapa === "equipe") {
      dados.equipe = message.body.trim();
      const participantes = carregarParticipantes();
      if (!participantes.find(p => p.id === id)) {
        participantes.push({
          id,
          nick: dados.nick,
          nome: dados.nome,
          equipe: dados.equipe
        });
        await salvarParticipantes(participantes);
        message.reply("Registro concluído! Agora você pode usar !tempo sem enviar o nick.");
      } else {
        message.reply("Você já está registrado.");
      }
      delete registrosPendentes[id];
      return;
    }
  }

  // --- Comando !registrar ---
  if (texto === "!registrar") {
    const participantes = carregarParticipantes();
    if (participantes.find(p => p.id === id)) {
      message.reply("Você já está registrado!");
      return;
    }
    registrosPendentes[id] = { etapa: "nick" };
    message.reply("Vamos registrar você! Digite seu nick de jogo:");
    return;
  }


// Comando !editar
if (texto === "!editar") {
    const participantes = carregarParticipantes();
    const jogador = participantes.find(p => p.id === id);

    if (!jogador) {
        message.reply("Você ainda não está registrado! Use !registrar primeiro.");
        return;
    }

    // inicia fluxo de edição
    edicoesPendentes[id] = { etapa: "nick", dados: { ...jogador } };
    message.reply(
        `Você vai editar seu cadastro.\n` +
        `Digite seu novo nick ou envie "-" para manter:`
    );
    return;
}

// Processa etapas de edição
if (edicoesPendentes[id]) {
    const etapa = edicoesPendentes[id].etapa;
    const dados = edicoesPendentes[id].dados;
    const resposta = message.body.trim();

    if (etapa === "nick") {
        if (resposta !== "-") dados.nick = resposta;
        edicoesPendentes[id].etapa = "nome";
        message.reply(`Digite seu novo nome ou "-" para manter:`);
        return;
    }

    if (etapa === "nome") {
        if (resposta !== "-") dados.nome = resposta;
        edicoesPendentes[id].etapa = "equipe";
        message.reply(`Digite sua nova equipe ou "-" para manter:`);
        return;
    }

    if (etapa === "equipe") {
        if (resposta !== "-") dados.equipe = resposta;

        // salva alterações no JSON
        const participantes = carregarParticipantes();
        const index = participantes.findIndex(p => p.id === id);
        if (index !== -1) {
            participantes[index] = dados;
            await salvarParticipantes(participantes);
            message.reply("Cadastro atualizado com sucesso!");
        } else {
            message.reply("Erro: participante não encontrado.");
        }

        delete edicoesPendentes[id];
        return;
    }
}

  // --- Comando !adm ---
  if (texto === "!adm") {
    if (!ADM_IDS.includes(message.author)) {
      ADM_IDS.push(message.author);
      message.reply("Você foi registrado como administrador!");
    } else {
      message.reply("Você já é um administrador");
    }
    return;
  }

  // --- Comando !menu ---
  if (texto === "!menu") {
    mostrarMenu(message);
    return;
  }

  // --- Comandos de admin ---
  if (texto.startsWith("!pen")) {
    if (!isAdmin(message)) {
      message.reply("Você não tem permissão pra usar esse comando.");
      return;
    }
    aplicarPenalidade(message);
    return;
  }

  if (texto.startsWith("!unpen")) {
    if (!isAdmin(message)) {
      message.reply("Você não tem permissão pra usar esse comando.");
      return;
    }
    removerPenalidade(message);
    return;
  }

  // --- Comando !tabela ---
  if (texto.startsWith("!tabela")) {
    gerarTabela(message);
    return;
  }

  // --- Comando !tempo ---
  if (texto.startsWith("!tempo")) {
    const participantes = carregarParticipantes();
    const jogador = participantes.find(p => p.id === id);

    if (!jogador) {
      message.reply("Você precisa se registrar primeiro com !registrar");
      return;
    }

    const nick = jogador.nick;

    // --- Salva imagem ---
    if (!message.hasMedia) {
      message.reply("Envie a imagem com o tempo.");
      return;
    }
    const media = await message.downloadMedia();
    const buffer = Buffer.from(media.data, "base64");
    const nomeArquivo = `imagem_${nick}.png`;
    const caminho = `img/${nomeArquivo}`;
    fs.writeFileSync(caminho, buffer);

    // --- OCR ---
    const tempo = await read(caminho, nick);

    if (tempo) {
      message.reply(`${nick} seu tempo foi registrado: ${tempo}`);
    }

    // --- JSON de tempos ---
    const hoje = new Date().toISOString().split("T")[0];
    let dados = { data: hoje, tempos: [] };

    if (fs.existsSync("dados.json")) {
      dados = JSON.parse(fs.readFileSync("dados.json"));
    }

    if (dados.data !== hoje) {
      await message.reply(
        MessageMedia.fromFilePath("./dados.json")
      );
      dados = { data: hoje, tempos: [] };
    }

    const index = dados.tempos.findIndex(t => t.nick === nick);

    if (index !== -1) {
      dados.tempos[index].tempo = tempo;
      if (dados.tempos[index].penalidade === undefined) {
        dados.tempos[index].penalidade = 0;
      }
    } else {
      dados.tempos.push({
        nick,
        tempo,
        penalidade: 0
      });
    }

    fs.writeFileSync("dados.json", JSON.stringify(dados, null, 2));
    return;
  }

  // --- Se não reconhece o comando ---
  if (texto.startsWith("!")) {
    mostrarMenu(message);
    return;
  }

});

client.initialize();

// --- Funções auxiliares ---
function tempoParaMs(t) {
  const [min, rest] = t.split(":");
  const [sec, ms] = rest.split(".");
  return (
    parseInt(min) * 60000 +
    parseInt(sec) * 1000 +
    parseInt(ms)
  );
}

function msParaTempo(ms) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(mil).padStart(3, "0")}`;
}

async function gerarTabela(message) {
  if (!fs.existsSync("dados.json")) {
    message.reply("Nenhum tempo registrado ainda.");
    return;
  }

  const dados = JSON.parse(fs.readFileSync("dados.json"));

  if (dados.tempos.length === 0) {
    message.reply("Nenhum tempo registrado ainda.");
    return;
  }

  const ordenados = dados.tempos.sort((a, b) => {
    const tempoA = tempoParaMs(a.tempo) + (a.penalidade || 0) * 1000;
    const tempoB = tempoParaMs(b.tempo) + (b.penalidade || 0) * 1000;
    return tempoA - tempoB;
  });

  const nomeGP = message.body.replace("!tabela", "").trim().toUpperCase();
  let resposta = `${nomeGP || "GP"} \n\n`;

  ordenados.forEach((t, i) => {
    const tempoFinalMs = tempoParaMs(t.tempo) + (t.penalidade || 0) * 1000;
    const tempoFinal = msParaTempo(tempoFinalMs);
    const pen = t.penalidade ? ` (+${t.penalidade}s)` : "";
    const participante = participantes.find(p => p.nick === t.nick);
  	const equipe = participante ? participante.equipe : "N/D";

  	resposta += `P${i + 1} - ${tempoFinal}${pen} - ${t.nick} (${equipe})\n`;
  });

  message.reply(resposta);
}

async function aplicarPenalidade(message) {
  const partes = message.body.split(" ");
  const segundos = parseInt(partes[1]);
  const nick = partes.slice(2).join(" ");

  if (isNaN(segundos) || !nick) {
    message.reply("Use assim: !pen 5 Nome");
    return;
  }

  if (!fs.existsSync("dados.json")) {
    message.reply("Nenhum dado encontrado.");
    return;
  }

  const dados = JSON.parse(fs.readFileSync("dados.json"));
  const piloto = dados.tempos.find(t => t.nick.toLowerCase() === nick.toLowerCase());

  if (!piloto) {
    message.reply("Piloto não encontrado.");
    return;
  }

  piloto.penalidade = piloto.penalidade || 0;
  piloto.penalidade += segundos;

  fs.writeFileSync("dados.json", JSON.stringify(dados, null, 2));
  message.reply(`Penalidade de ${segundos}s aplicada em ${nick}`);
}

async function removerPenalidade(message) {
  const partes = message.body.split(" ");
  const nick = partes.slice(1).join(" ");

  if (!nick) {
    message.reply("Use: !unpen Nome");
    return;
  }

  if (!fs.existsSync("dados.json")) {
    message.reply("Nenhum dado encontrado.");
    return;
  }

  const dados = JSON.parse(fs.readFileSync("dados.json"));
  const piloto = dados.tempos.find(t => t.nick.toLowerCase() === nick.toLowerCase());

  if (!piloto || piloto.penalidade === 0) {
    message.reply("Esse piloto não tem penalidade.");
    return;
  }

  piloto.penalidade = 0;
  fs.writeFileSync("dados.json", JSON.stringify(dados, null, 2));
  message.reply(`Penalidade removida de ${nick}`);
}

function mostrarMenu(message) {
  const menu = `🏁 *MENU DO BOT - CAMPEONATO*

📥 *Envio de tempo*
!tempo
(envie junto a imagem, não precisa do nick)

📊 *Tabela*
!tabela Nome do GP
Ex: !tabela GP CHINA

⚠️ *Penalidade (ADM)*
!pen 5 Nome

❌ *Remover penalidade (ADM)*
!unpen Nome

ℹ️ *Observações*
- Envie print da tabela com seu tempo
- Penalidades são em segundos

🏎️ Boa corrida!`;

  message.reply(menu);
}