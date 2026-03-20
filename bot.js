  const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
  const qrcode = require("qrcode-terminal");
  const fs = require("fs");
  const { read } = require("./ocrbot");
  const {readD } = require("./ocr_for2");

const admsFile = "adms.json";
let ADM_IDS = carregarAdms();
// Carrega admins do arquivo
function carregarAdms() {
  if (!fs.existsSync(admsFile)) return ADM_IDS; // usa os iniciais se o arquivo não existir
  const dados = JSON.parse(fs.readFileSync(admsFile));
  return Array.isArray(dados) ? dados : ADM_IDS;
}

// Salva admins no arquivo
function salvarAdms(dados) {
  fs.writeFileSync(admsFile, JSON.stringify(dados, null, 2));
}
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: "/usr/bin/chromium-browser",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process"
    ]
  }
});

  const chatID = "120363423256823339@g.us";

  const participantesFile = "participantes.json";
  let registrosPendentes = {}; // controle do fluxo de registro
  let edicoesPendentes = {}; // controla quem está editando
  let salvando = false; // variável global no topo do arquivo
  const racemodeFile = "racemode.json";

  function carregarRaceMode() {
      if (!fs.existsSync(racemodeFile)) return {};
      return JSON.parse(fs.readFileSync(racemodeFile));
  }

  function salvarRaceMode(dados) {
      fs.writeFileSync(racemodeFile, JSON.stringify(dados, null, 2));
  }


// Carrega admins do arquivo
function carregarAdms() {
  if (!fs.existsSync(admsFile)) return ADM_IDS; // usa os iniciais se o arquivo não existir
  const dados = JSON.parse(fs.readFileSync(admsFile));
  return Array.isArray(dados) ? dados : ADM_IDS;
}

// Salva admins no arquivo
function salvarAdms(dados) {
  fs.writeFileSync(admsFile, JSON.stringify(dados, null, 2));
}
  // Funções auxiliares
  function carregarParticipantes() {
    if (!fs.existsSync(participantesFile)) return [];
    return JSON.parse(fs.readFileSync(participantesFile));
  }

  async function salvarParticipantes(dados) {
      while (salvando) {
          await new Promise(resolve => setTimeout(resolve, 5));
      }
      salvando = true;
      fs.writeFileSync(participantesFile, JSON.stringify(dados, null, 2));
      salvando = false;
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
        message.reply("Digite seu nome:");
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

    // --- Race Mode ---
    if (texto.startsWith("!racemode")) {
      if (!isAdmin(message)) {
          message.reply("Você não tem permissão pra usar esse comando.");
          return;
      }

      const partes = message.body.split(" ");
      const gpNome = partes.slice(1).join(" ").toUpperCase();

      if (!gpNome) {
          message.reply("Use: !racemode NOME_DO_GP");
          return;
      }

      const dados = carregarRaceMode();
      const agora = new Date();

      // Verifica se já existe qualquer GP em andamento (não importa o nome)
      for (let key in dados) {
        if (key === "current_gp") continue;
        const gp = dados[key];
        if (!gp) continue;
        const gpEnd = new Date(gp.race_end);
        if (agora < gpEnd) {
          message.reply(`Já existe um GP ativo (${key}). Termine com !endgp antes de iniciar outro.`);
          return;
        }
      }

      // Define horários fixos
      const qualyStart = new Date();
      qualyStart.setHours(12, 0, 0, 0); // 12:00 do dia atual
      const qualyEnd = new Date(qualyStart.getTime() + 24*60*60*1000); // +24h
      const raceStart = new Date(qualyEnd.getTime() + 1*60*60*1000); // 13h do segundo dia
      const raceEnd = new Date(raceStart.getTime() + 24*60*60*1000); // +24h

      dados[gpNome] = {
          qualy_start: qualyStart.toISOString(),
          qualy_end: qualyEnd.toISOString(),
          race_start: raceStart.toISOString(),
          race_end: raceEnd.toISOString()
      };
      dados.current_gp = gpNome;
      salvarRaceMode(dados);

      message.reply(`Race mode iniciado para ${gpNome}!\nQualy: 12h do dia 1 → 12h do dia 2\nCorrida: 13h do dia 2 → 13h do dia 3`);
      return;
    }

    // --- Comando !endgp ---
    if (texto.startsWith("!endgp")) {
      if (!isAdmin(message)) {
        message.reply("Apenas ADM pode encerrar um GP.");
        return;
      }

      const racemode = carregarRaceMode();
      if (!racemode.current_gp) {
        message.reply("Nenhum GP ativo no momento.");
        return;
      }

      delete racemode[racemode.current_gp];
      delete racemode.current_gp;
      salvarRaceMode(racemode);

      message.reply("GP encerrado com sucesso!");
      return;
    }

    // --- Comando !data ---
    if (texto.startsWith("!data")) {
      if (!isAdmin(message)) {
        message.reply("Apenas ADM pode solicitar os dados.");
        return;
      }

      if (!fs.existsSync("dados.json")) {
        message.reply("Nenhum dado registrado ainda.");
        return;
      }

      const dados = JSON.parse(fs.readFileSync("dados.json"));
      const partes = message.body.split(" ");
      const formato = partes[1] ? partes[1].toLowerCase() : "msg"; // padrão msg

      if (formato === "csv") {
        const csv = jsonParaCSV(dados);
        const caminhoCSV = "./dados.csv";
        fs.writeFileSync(caminhoCSV, csv);
        await message.reply(MessageMedia.fromFilePath(caminhoCSV));
      } else if (formato === "txt") {
        const txt = jsonParaTXT(dados);
        const caminhoTXT = "./dados.txt";
        fs.writeFileSync(caminhoTXT, txt);
        await message.reply(MessageMedia.fromFilePath(caminhoTXT));
      } else { // msg
        const msg = jsonParaTXT(dados);
        message.reply(msg);
      }

      // Limpa o arquivo de tempos
      fs.writeFileSync("dados.json", JSON.stringify({ data: new Date().toISOString().split("T")[0], tempos: [] }, null, 2));
      return;
    }

    // --- Comando !credencial ---
    if (texto.startsWith("!credencial")) {
      const participantes = carregarParticipantes();
      const jogador = participantes.find(p => p.id === id);

      if (!jogador) {
        message.reply("Você ainda não possui cadastro. Use !registrar para se cadastrar.");
        return;
      }

      message.reply(
        `Cadastro:\nNick: ${jogador.nick}\nNome: ${jogador.nome}\nEquipe: ${jogador.equipe}`
      );
      return;
    }
    if (texto.toLowerCase() === "!mylap") {
      const participantes = carregarParticipantes();
      const jogador = participantes.find(p => p.id === id);

      if (!jogador) {
        message.reply("Você ainda não está registrado. Use !registrar.");
        return;
      }

      const nick = jogador.nick;

      if (!fs.existsSync("dados.json")) {
        message.reply("Nenhum tempo registrado ainda.");
        return;
      }

      const dados = JSON.parse(fs.readFileSync("dados.json"));
      const registro = dados.tempos.find(t => t.nick === nick);

      if (!registro) {
        message.reply("Você ainda não enviou nenhum tempo hoje.");
        return;
      }

      const tempoFinalMs = tempoParaMs(registro.tempo) + (registro.penalidade || 0) * 1000;
      const tempoFinal = msParaTempo(tempoFinalMs);
      const pen = registro.penalidade ? ` (+${registro.penalidade}s)` : "";

      message.reply(`Seu tempo registrado hoje: ${tempoFinal}${pen}`);
      return;
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

    // --- Comando !editar ---
    if (texto === "!editar") {
      const participantes = carregarParticipantes();
      const jogador = participantes.find(p => p.id === id);

      if (!jogador) {
          message.reply("Você ainda não está registrado! Use !registrar primeiro.");
          return;
      }

      edicoesPendentes[id] = { etapa: "nick", dados: { ...jogador } };
      message.reply(`Você vai editar seu cadastro.\nDigite seu novo nick ou envie "-" para manter:`);
      return;
    }

    // --- Processa etapas de edição ---
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
        salvarAdms(ADM_IDS); // salva no arquivo
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

      // --- Verificação de racemode ---
      const racemode = carregarRaceMode();
      const gpAtual = racemode.current_gp ? racemode[racemode.current_gp] : null;

      if (!gpAtual) {
          message.reply("Nenhum GP ativo no momento. Aguarde um ADM iniciar com !racemode.");
          return;
      }

      const agora = new Date();
      let aplicarPenal = 0; // default 0s

      const qualyStart = new Date(gpAtual.qualy_start);
      const qualyEnd = new Date(gpAtual.qualy_end);
      const raceStart = new Date(gpAtual.race_start);
      const raceEnd = new Date(gpAtual.race_end);

      if (agora >= qualyStart && agora <= qualyEnd) {
          // dentro da Qualy
      } else if (agora >= raceStart && agora <= raceEnd) {
          // dentro da Corrida
      } else if (agora > raceEnd) {
          aplicarPenal = 1;
          message.reply("Tempo enviado fora do horário da corrida, penalidade de 1 segundo aplicada!");
      } else {
          message.reply("Ainda não é horário de envio de tempo.");
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
        dados = { data: hoje, tempos: [] };
      }

      const index = dados.tempos.findIndex(t => t.nick === nick);

      if (index !== -1) {
        dados.tempos[index].tempo = tempo;
        dados.tempos[index].penalidade = (dados.tempos[index].penalidade || 0) + aplicarPenal;
      } else {
        dados.tempos.push({
          nick,
          tempo,
          penalidade: aplicarPenal
        });
      }
      fs.writeFileSync("dados.json", JSON.stringify(dados, null, 2));
      return;
    }

    if (texto.toLowerCase().startsWith("!bestlap")) {
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

      // --- Verificação de racemode ---
      const racemode = carregarRaceMode();
      const gpAtual = racemode.current_gp ? racemode[racemode.current_gp] : null;

      if (!gpAtual) {
          message.reply("Nenhum GP ativo no momento. Aguarde um ADM iniciar com !racemode.");
          return;
      }

      const agora = new Date();
      let aplicarPenal = 0; // default 0s

      const qualyStart = new Date(gpAtual.qualy_start);
      const qualyEnd = new Date(gpAtual.qualy_end);
      const raceStart = new Date(gpAtual.race_start);
      const raceEnd = new Date(gpAtual.race_end);

      if (agora >= qualyStart && agora <= qualyEnd) {
          // dentro da Qualy
      } else if (agora >= raceStart && agora <= raceEnd) {
          // dentro da Corrida
      } else if (agora > raceEnd) {
          aplicarPenal = 1;
          message.reply("Tempo enviado fora do horário da corrida, penalidade de 1 segundo aplicada!");
      } else {
          message.reply("Ainda não é horário de envio de tempo.");
          return;
      }

      const media = await message.downloadMedia();
      const buffer = Buffer.from(media.data, "base64");
      const nomeArquivo = `imagem_${nick}.png`;
      const caminho = `img/${nomeArquivo}`;
      fs.writeFileSync(caminho, buffer);

      // --- OCR ---
      const tempo = await readD(caminho);
      console.log(tempo);
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
        dados = { data: hoje, tempos: [] };
      }

      const index = dados.tempos.findIndex(t => t.nick === nick);

      if (index !== -1) {
        dados.tempos[index].tempo = tempo;
        dados.tempos[index].penalidade = (dados.tempos[index].penalidade || 0) + aplicarPenal;
      } else {
        dados.tempos.push({
          nick,
          tempo,
          penalidade: aplicarPenal
        });
      }
      fs.writeFileSync("dados.json", JSON.stringify(dados, null, 2));
      return;
    }

    // --- Se não reconhece o comando ---
    if (texto.startsWith("!")) {
      mostrarMenuErro(message);
      return;
    }
  });

  client.initialize();

  // --- Funções auxiliares ---
  function tempoParaMs(t) {
    const [min, rest] = t.split(":");
    const [sec, ms] = rest.split(".");
    return parseInt(min) * 60000 + parseInt(sec) * 1000 + parseInt(ms);
  }

  function msParaTempo(ms) {
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    const mil = ms % 1000;
    return `${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}.${String(mil).padStart(3,"0")}`;
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
  const participantes = carregarParticipantes();

  ordenados.forEach((t, i) => {
    const tempoFinalMs = tempoParaMs(t.tempo) + (t.penalidade || 0) * 1000;
    const tempoFinal = msParaTempo(tempoFinalMs);
    const pen = t.penalidade ? ` (+${t.penalidade}s)` : "";
    const participante = participantes.find(p => p.nick === t.nick);
    const nomeExibido = participante ? participante.nome : t.nick;
    const equipe = participante ? participante.equipe : "N/D";

    resposta += `P${i+1} - ${tempoFinal}${pen} - ${nomeExibido} (${equipe})\n`;
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

  📥 *Envio de tempo* → !tempo
  (envie junto a imagem, não precisa do nick)

  📊 *Tabela* → !tabela Nome do GP

  ⚠️ *Penalidade (ADM)* → !pen 5 Nome
  ❌ *Remover penalidade (ADM)* → !unpen Nome

  🏁 *Iniciar corrida (Quali e GP) → !racemode nome do GP
  📂 *Dados do dia (ADM)* → !data
  🛑 *Encerrar GP (ADM)* → !endgp
  🆔 *Sua credencial* → !credencial
  🆔 *Editar informações de registro* → !editar

  ℹ️ *Observações*
  - Envie print da tabela com seu tempo
  - Penalidades são em segundos

  🏎️ Boa corrida!`;
    message.reply(menu);
  }

function mostrarMenuErro(message) {
  const menu = `❌COMANDO NÃO IDENTIFICADO


🏁 *MENU DO BOT - CAMPEONATO*

📥 *Envio de tempo* 
→ !tempo - use para enviar imagem da tabela diária
→ !bestlap - use para enviar imagem da vitória com best lap (caso você não apareça no top20)
(envie junto a imagem, não precisa do nick)

📊 *Tabela* → !tabela Nome do GP

⚠️ *Penalidade (ADM)* → !pen 5 Nome
❌ *Remover penalidade (ADM)* → !unpen Nome

🏁 *Iniciar corrida (Quali e GP) → !racemode nome do GP
📂 *Dados do dia (ADM)* → !data
🛑 *Encerrar GP (ADM)* → !endgp
🆔 *Sua credencial* → !credencial
🆔 *Editar informações de registro* → !editar

ℹ️ *Observações*
- Envie print da tabela com seu tempo
- Penalidades são em segundos

🏎️ Boa corrida!`;
  message.reply(menu);
}

function jsonParaCSV(dados) {
  if (!dados.tempos || dados.tempos.length === 0) return "";

  const linhas = ["Nick,Tempo,Penalidade"];
  dados.tempos.forEach(t => {
    linhas.push(`${t.nick},${t.tempo},${t.penalidade || 0}`);
  });
  return linhas.join("\n");
}

function jsonParaTXT(dados) {
  if (!dados.tempos || dados.tempos.length === 0) return "Nenhum tempo registrado.";

  let texto = `🏁 Tabela de Tempos - ${dados.data}\n\n`;
  dados.tempos.forEach((t, i) => {
      texto += `P${i + 1} - Nick: ${t.nick}\n`;
      texto += `Tempo: ${t.tempo}\n`;
      texto += `Penalidade: ${t.penalidade || 0}s\n`;
      texto += "----------------\n";
  });
  return texto;
}

const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Bot rodando");
});

app.listen(process.env.PORT || 3000);
