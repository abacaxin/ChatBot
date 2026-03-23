process.env.TZ = "America/Sao_Paulo";

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const { read } = require("./ocr");
const { readD } = require("./ocr_bestlap");

const REGISTRO_GROUP_ID     = "120363405848517876@g.us";
const QUALI_GROUP_ID        = "120363425428525877@g.us";
const TEMPO_GROUP_ID        = "120363423390684515@g.us";
const SOLICITACOES_GROUP_ID = "120363406605100670@g.us";

const COMISSARIOS = [
  "174676940705846@lid",
  "139449249824780@lid"
];

const gp_IDS = [
  "120363425840527357@g.us",
  "120363405848517876@g.us",
  "120363406708379841@g.us",
  "120363423256823339@g.us",
  "120363423390684515@g.us",
  "120363425428525877@g.us",
  "120363426666253539@g.us",
];

const F1_POINTS    = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const QUALI_POINTS = [3, 2, 1];

const participantesFile  = "participantes.json";
const admsFile           = "adms.json";
const racemodeFile       = "racemode.json";
const dadosFile          = "dados.json";
const equipesFile        = "equipes.json";
const penPendentesFile   = "penalidades_pendentes.json";
const historicoFile      = "historico.json";
const campeonatoFile     = "campeonato.json";
const bestlapPendFile    = "bestlap_pendentes.json";
const imgDir             = "img";

let registrosPendentes    = {};
let edicoesPendentes      = {};
let aguardandoComprovacao = {};
let salvando              = false;
let timerAbreQuali  = null;
let timerFimQuali   = null;
let timerGridQuali  = null;
let timerAbreRace   = null;
let timerFimRace    = null;

function carregar(arquivo, padrao) {
  if (padrao === undefined) padrao = [];
  if (!fs.existsSync(arquivo)) return padrao;
  try { return JSON.parse(fs.readFileSync(arquivo)); }
  catch { return padrao; }
}
function salvar(arquivo, dados) { fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2)); }
function carregarAdms()          { return carregar(admsFile, []); }
function salvarAdms(d)           { salvar(admsFile, d); }
function carregarParticipantes() { return carregar(participantesFile, []); }
function carregarRaceMode()      { return carregar(racemodeFile, {}); }
function salvarRaceMode(d)       { salvar(racemodeFile, d); }
function carregarEquipes()       { return carregar(equipesFile, []); }
function carregarPenPendentes()  { return carregar(penPendentesFile, {}); }
function salvarPenPendentes(d)   { salvar(penPendentesFile, d); }
function carregarHistorico()     { return carregar(historicoFile, []); }
function salvarHistorico(d)      { salvar(historicoFile, d); }
function carregarCampeonato() {
  const dados = carregar(campeonatoFile, { pilotos: {}, equipes: {} });
  // garante estrutura mesmo se o arquivo existir mas estiver incompleto
  if (!dados.pilotos) dados.pilotos = {};
  if (!dados.equipes) dados.equipes = {};
  return dados;
}
function salvarCampeonato(d)     { salvar(campeonatoFile, d); }
function carregarBestlapPend()   { return carregar(bestlapPendFile, {}); }
function salvarBestlapPend(d)    { salvar(bestlapPendFile, d); }

async function salvarParticipantes(dados) {
  while (salvando) await new Promise(r => setTimeout(r, 5));
  salvando = true;
  salvar(participantesFile, dados);
  salvando = false;
}

let ADM_IDS = carregarAdms();
function isAdmin(message)      { return ADM_IDS.includes(message.author || message.from); }
function isComissario(message) { return COMISSARIOS.includes(message.author || message.from) || isAdmin(message); }
function isGP(message)         { return gp_IDS.includes(message.from); }

function tempoParaMs(t) {
  if (!t) return Infinity;
  const [min, rest] = t.split(":");
  const [sec, ms]   = rest.split(".");
  return parseInt(min) * 60000 + parseInt(sec) * 1000 + parseInt(ms);
}
function msParaTempo(ms) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return String(min).padStart(2,"0") + ":" + String(sec).padStart(2,"0") + "." + String(mil).padStart(3,"0");
}
function addDay(data, dia) {
  const nova = new Date(data);
  nova.setDate(nova.getDate() + dia);
  return nova.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function getSessaoAtual(gpAtual) {
  if (!gpAtual) return "AGUARDANDO";
  const agora      = new Date();
  const qualyStart = new Date(gpAtual.qualy_start);
  const qualyEnd   = new Date(gpAtual.qualy_end);
  const raceStart  = new Date(gpAtual.race_start);
  const raceEnd    = new Date(gpAtual.race_end);
  if (agora >= qualyStart && agora <= qualyEnd) return "QUALI";
  if (agora >= raceStart  && agora <= raceEnd)  return "RACE";
  if (agora > raceEnd)                          return "ENCERRADO";
  return "AGUARDANDO";
}
function carregarDados() {
  if (!fs.existsSync(dadosFile)) return null;
  return JSON.parse(fs.readFileSync(dadosFile));
}
function salvarDados(dados) { salvar(dadosFile, dados); }
function getDadosHoje() {
  const hoje  = new Date().toISOString().split("T")[0];
  const dados = carregarDados();
  if (!dados || dados.data !== hoje) return { data: hoje, tempos: [] };
  return dados;
}
function ordenarTempos(tempos) {
  return [...tempos].filter(t => t.tempo).sort((a, b) => {
    const tA = tempoParaMs(a.tempo) + (a.penalidade || 0) * 1000;
    const tB = tempoParaMs(b.tempo) + (b.penalidade || 0) * 1000;
    return tA - tB;
  });
}
function limparImg() {
  if (!fs.existsSync(imgDir)) return;
  fs.readdirSync(imgDir).forEach(f => { try { fs.unlinkSync(path.join(imgDir, f)); } catch {} });
}
function listarEquipes() {
  const equipes = carregarEquipes();
  if (equipes.length === 0) return "Nenhuma equipe cadastrada ainda.";
  return equipes.map((e, i) => (i + 1) + ". " + e).join("\n");
}

function mostrarMenu(message) {
  message.reply(
    "🏁 *MENU DO BOT - CAMPEONATO*\n\n" +
    "*📥 Envio de tempo*\n" +
    "→ !tempo — tabela diária (com imagem)\n" +
    "→ !bestlap — vitória/best lap fora do top20 (com imagem)\n\n" +
    "*📊 Sessão*\n" +
    "→ !tabela — classificação atual da sessão\n" +
    "→ !mylap — meu tempo e posição atual\n" +
    "→ !gap POSICAO — meu gap até uma posição\n" +
    "→ !gapto NOME — meu gap até um piloto\n\n" +
    "*🏆 Campeonato*\n" +
    "→ !campeonato — classificação de pilotos\n" +
    "→ !construtores — classificação de equipes\n" +
    "→ !stats NICK — histórico de um piloto\n\n" +
    "*📋 Geral*\n" +
    "→ !grid — pilotos agrupados por equipe\n" +
    "→ !credencial — ver seu cadastro\n" +
    "→ !editar — editar seu cadastro\n\n" +
    "*🔧 ADM / Comissários*\n" +
    "→ !racemode NOME — iniciar GP\n" +
    "→ !endgp — encerrar GP e gerar resultado\n" +
    "→ !pen SEGUNDOS NICK — aplicar penalidade\n" +
    "→ !unpen NICK — remover penalidade\n" +
    "→ !aprovar NICK — aprovar bestlap pendente\n" +
    "→ !remover NICK — remover tempo de um piloto\n" +
    "→ !data / !data csv / !data txt — exportar dados\n\n" +
    "ℹ️ Pontuação quali: P1=3pts P2=2pts P3=1pt\n" +
    "ℹ️ Pontuação corrida: 25-18-15-12-10-8-6-4-2-1\n" +
    "🏎️ Boa corrida!"
  );
}
function mostrarMenuErro(message) {
  message.reply("❌ *COMANDO NÃO IDENTIFICADO*\n\nUse !menu para ver os comandos disponíveis.");
}

function montarTabelaTexto(tempos, titulo) {
  const participantes = carregarParticipantes();
  const ordenados     = ordenarTempos(tempos);
  let resposta        = "🏁 *" + titulo + "* 🏁\n\n";
  ordenados.forEach((t, i) => {
    const ms          = tempoParaMs(t.tempo) + (t.penalidade || 0) * 1000;
    const tempoFinal  = msParaTempo(ms);
    const pen         = t.penalidade ? " (+" + t.penalidade + "s)" : "";
    const p           = participantes.find(x => x.nick === t.nick);
    const nomeExibido = p ? p.nome : t.nick;
    const equipe      = p ? p.equipe : "N/D";
    resposta += "P" + (i + 1) + " - " + nomeExibido + " (*" + equipe + "*)\nTempo: " + tempoFinal + pen + "\n----------------\n";
  });
  return resposta;
}

async function gerarTabela(message) {
  const racemode = carregarRaceMode();
  const gpAtual  = racemode.current_gp ? racemode[racemode.current_gp] : null;
  const sessao   = getSessaoAtual(gpAtual);
  if (!gpAtual || (sessao !== "QUALI" && sessao !== "RACE")) {
    message.reply("A tabela só está disponível durante uma sessão ativa.");
    return;
  }
  const dados = carregarDados();
  if (!dados || dados.tempos.length === 0) { message.reply("Nenhum tempo registrado ainda."); return; }
  message.reply(montarTabelaTexto(dados.tempos, "RESULTADOS: GP DE " + racemode.current_gp));
}

async function gerarTabelaQuali(nomeGP) {
  const dados = carregarDados();
  if (!dados || dados.tempos.length === 0) { client.sendMessage(QUALI_GROUP_ID, "Nenhum tempo registrado na quali."); return; }
  const ordenados     = ordenarTempos(dados.tempos);
  const participantes = carregarParticipantes();
  salvarPontuacaoQuali(nomeGP, ordenados, participantes);
  client.sendMessage(QUALI_GROUP_ID, montarTabelaTexto(dados.tempos, "GRID DE LARGADA: GP " + nomeGP));
}

async function gerarResultado(message) {
  const dados    = carregarDados();
  const racemode = carregarRaceMode();
  const nomeGP   = racemode.current_gp || "GP ENCERRADO";
  if (!dados || dados.tempos.length === 0) { message.reply("Não há tempos registrados para este GP."); return; }
  const ordenados     = ordenarTempos(dados.tempos);
  const participantes = carregarParticipantes();
  let resposta        = "🏆 *RESULTADO OFICIAL: " + nomeGP + "* 🏆\n📅 " + new Date().toLocaleDateString("pt-BR") + "\n\n";
  ordenados.forEach((t, i) => {
    const ms         = tempoParaMs(t.tempo) + (t.penalidade || 0) * 1000;
    const tempoFinal = msParaTempo(ms);
    const pen        = t.penalidade ? " (+" + t.penalidade + "s)" : "";
    const p          = participantes.find(x => x.nick === t.nick);
    const nome       = p ? p.nome : t.nick;
    const equipe     = p ? p.equipe : "Particular";
    const medalha    = i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : (i + 1) + "º ";
    resposta += medalha + "*" + nome + "* (" + equipe + ")\n⏱️ " + tempoFinal + pen + "\n--------------------------\n";
  });
  message.reply(resposta);
  salvarPontuacao(nomeGP, ordenados, participantes);
}

function salvarPontuacao(nomeGP, ordenados, participantes) {
  const campeonato = carregarCampeonato();
  const historico  = carregarHistorico();
  const entrada    = { gp: nomeGP, data: new Date().toISOString(), resultado: [] };
  ordenados.forEach((t, i) => {
    const pontos = F1_POINTS[i] || 0;
    const p      = participantes.find(x => x.nick === t.nick);
    const nome   = p ? p.nome : t.nick;
    const equipe = p ? p.equipe : "Particular";
    if (!campeonato.pilotos[nome]) campeonato.pilotos[nome] = { pontos: 0, equipe };
    campeonato.pilotos[nome].pontos += pontos;
    if (!campeonato.equipes[equipe]) campeonato.equipes[equipe] = { pontos: 0 };
    campeonato.equipes[equipe].pontos += pontos;
    entrada.resultado.push({ posicao: i + 1, nome, equipe, pontos });
  });
  historico.push(entrada);
  salvarCampeonato(campeonato);
  salvarHistorico(historico);
}

function salvarPontuacaoQuali(nomeGP, ordenados, participantes) {
  const campeonato = carregarCampeonato();
  const historico  = carregarHistorico();
  const entrada    = { gp: nomeGP + " (QUALI)", data: new Date().toISOString(), resultado: [] };
  ordenados.forEach((t, i) => {
    const pontos = QUALI_POINTS[i] || 0;
    if (pontos === 0) return;
    const p      = participantes.find(x => x.nick === t.nick);
    const nome   = p ? p.nome : t.nick;
    const equipe = p ? p.equipe : "Particular";
    if (!campeonato.pilotos[nome]) campeonato.pilotos[nome] = { pontos: 0, equipe };
    campeonato.pilotos[nome].pontos += pontos;
    if (!campeonato.equipes[equipe]) campeonato.equipes[equipe] = { pontos: 0 };
    campeonato.equipes[equipe].pontos += pontos;
    entrada.resultado.push({ posicao: i + 1, nome, equipe, pontos });
  });
  historico.push(entrada);
  salvarCampeonato(campeonato);
  salvarHistorico(historico);
}

async function aplicarPenalidade(message) {
  const partes   = message.body.split(" ");
  const segundos = parseInt(partes[1]);
  const nick     = partes.slice(2).join(" ");
  if (isNaN(segundos) || !nick) { message.reply("Use: !pen SEGUNDOS NICK\nEx: !pen 5 Daniel"); return; }
  const racemode = carregarRaceMode();
  const gpAtual  = racemode.current_gp ? racemode[racemode.current_gp] : null;
  const sessao   = getSessaoAtual(gpAtual);
  if (sessao === "QUALI" || sessao === "RACE") {
    const dados = carregarDados();
    if (dados) {
      const piloto = dados.tempos.find(t => t.nick.toLowerCase() === nick.toLowerCase());
      if (piloto) {
        piloto.penalidade = (piloto.penalidade || 0) + segundos;
        salvarDados(dados);
        message.reply("✅ Penalidade de " + segundos + "s aplicada em " + nick);
        return;
      }
    }
    const pend = carregarPenPendentes();
    pend[nick.toLowerCase()] = (pend[nick.toLowerCase()] || 0) + segundos;
    salvarPenPendentes(pend);
    message.reply("⏳ " + nick + " ainda não enviou tempo. Penalidade de " + segundos + "s guardada e será aplicada quando enviar.");
  } else {
    const pend = carregarPenPendentes();
    pend[nick.toLowerCase()] = (pend[nick.toLowerCase()] || 0) + segundos;
    salvarPenPendentes(pend);
    message.reply("📋 Nenhuma sessão ativa. " + nick + " receberá penalidade de " + segundos + "s na próxima sessão.");
  }
}

async function removerPenalidade(message) {
  const partes = message.body.split(" ");
  const nick   = partes.slice(1).join(" ");
  if (!nick) { message.reply("Use: !unpen NICK"); return; }
  const dados = carregarDados();
  if (dados) {
    const piloto = dados.tempos.find(t => t.nick.toLowerCase() === nick.toLowerCase());
    if (piloto && piloto.penalidade) {
      piloto.penalidade = 0;
      salvarDados(dados);
      message.reply("✅ Penalidade removida de " + nick);
      return;
    }
  }
  const pend = carregarPenPendentes();
  if (pend[nick.toLowerCase()]) {
    delete pend[nick.toLowerCase()];
    salvarPenPendentes(pend);
    message.reply("✅ Penalidade pendente removida de " + nick);
    return;
  }
  message.reply(nick + " não tem nenhuma penalidade registrada.");
}

async function removerTempo(message) {
  const nick = message.body.split(" ").slice(1).join(" ").trim();
  if (!nick) { message.reply("Use: !remover NICK"); return; }
  let removido = false;
  const dados = carregarDados();
  if (dados) {
    const index = dados.tempos.findIndex(t => t.nick.toLowerCase() === nick.toLowerCase());
    if (index !== -1) { dados.tempos.splice(index, 1); salvarDados(dados); removido = true; }
  }
  const pend = carregarBestlapPend();
  if (pend[nick.toLowerCase()]) { delete pend[nick.toLowerCase()]; salvarBestlapPend(pend); removido = true; }
  if (removido) {
    message.reply("✅ Tempo de " + nick + " removido com sucesso.");
  } else {
    message.reply("❌ Nenhum tempo encontrado para " + nick + ".");
  }
}

async function aprovarBestlap(message) {
  const nick = message.body.split(" ").slice(1).join(" ").trim();
  if (!nick) { message.reply("Use: !aprovar NICK"); return; }
  const pend   = carregarBestlapPend();
  const entrada = pend[nick.toLowerCase()];
  if (!entrada) { message.reply("❌ Nenhum bestlap pendente para " + nick + "."); return; }
  let dados    = getDadosHoje();
  const novoMs = tempoParaMs(entrada.tempo);
  const index  = dados.tempos.findIndex(t => t.nick === entrada.nick);
  if (index !== -1) {
    const tempoAtualMs = tempoParaMs(dados.tempos[index].tempo);
    if (novoMs < tempoAtualMs) {
      dados.tempos[index].tempo      = entrada.tempo;
      dados.tempos[index].penalidade = (dados.tempos[index].penalidade || 0) + (entrada.penalidade || 0);
    } else {
      message.reply("⚠️ O tempo pendente de " + nick + " (" + entrada.tempo + ") não é melhor que o já registrado. Aprovação cancelada.");
      delete pend[nick.toLowerCase()];
      salvarBestlapPend(pend);
      return;
    }
  } else {
    dados.tempos.push({ nick: entrada.nick, tempo: entrada.tempo, penalidade: entrada.penalidade || 0 });
  }
  salvarDados(dados);
  delete pend[nick.toLowerCase()];
  salvarBestlapPend(pend);
  message.reply("✅ Bestlap de " + nick + " aprovado! Tempo: " + entrada.tempo);
  client.sendMessage(TEMPO_GROUP_ID, "✅ *Bestlap aprovado!*\n👤 " + nick + "\n⏱️ " + entrada.tempo);
}

function verificarFastestLap(dados, nick, novoTempoMs, sessao) {
  const outros = dados.tempos.filter(t => t.nick !== nick && t.tempo);
  if (outros.length === 0) return;
  const fastestOutros = Math.min(...outros.map(t => tempoParaMs(t.tempo) + (t.penalidade || 0) * 1000));
  if (novoTempoMs < fastestOutros) {
    const label   = sessao === "QUALI" ? "QUALI" : "CORRIDA";
    const grupoID = sessao === "QUALI" ? QUALI_GROUP_ID : TEMPO_GROUP_ID;
    client.sendMessage(grupoID, "🟣 *VOLTA MAIS RÁPIDA DA " + label + "!*\n👤 " + nick + "\n⏱️ " + msParaTempo(novoTempoMs));
  }
}

async function handleTempo(message, jogador) {
  const racemode = carregarRaceMode();
  const gpAtual  = racemode.current_gp ? racemode[racemode.current_gp] : null;
  if (!gpAtual) { message.reply("Nenhum GP ativo no momento. Aguarde um ADM iniciar com !racemode."); return; }
  const sessao = getSessaoAtual(gpAtual);
  const nick   = jogador.nick;
  const nomeGP = racemode.current_gp;
  if (sessao === "RACE") {
    const d = getDadosHoje();
    if (d.tempos.find(t => t.nick === nick)) { message.reply("🚫 Na corrida só é permitido enviar o tempo UMA vez."); return; }
  } else if (sessao === "ENCERRADO") {
    message.reply("⏱️ A sessão já encerrou. Tempo fora do horário, penalidade de 1 segundo aplicada!");
  } else if (sessao !== "QUALI") {
    message.reply("Ainda não é horário de envio de tempo.");
    return;
  }
  if (!message.hasMedia) { message.reply("Envie a imagem junto com o comando."); return; }
  const agora        = new Date();
  const raceEnd      = new Date(gpAtual.race_end);
  const aplicarPenal = agora > raceEnd ? 1 : 0;
  if (aplicarPenal) message.reply("Tempo enviado fora do horário da corrida, penalidade de 1 segundo aplicada!");
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir);
  const media   = await message.downloadMedia();
  const buffer  = Buffer.from(media.data, "base64");
  const caminho = path.join(imgDir, "imagem_" + nick + ".png");
  fs.writeFileSync(caminho, buffer);
  const resultado = await read(caminho, nick, nomeGP);
  if (!resultado) { message.reply("Não consegui ler o tempo da imagem. Tente novamente."); return; }
  if (resultado && resultado.erro === "gp_nao_encontrado") {
    message.reply("❌ A imagem não parece ser do GP atual (*" + nomeGP + "*). Verifique se está enviando a foto correta.");
    return;
  }
  const tempo       = resultado;
  const pend        = carregarPenPendentes();
  const penPendente = pend[nick.toLowerCase()] || 0;
  if (penPendente) { delete pend[nick.toLowerCase()]; salvarPenPendentes(pend); }
  let dados    = getDadosHoje();
  const novoMs = tempoParaMs(tempo);
  const index  = dados.tempos.findIndex(t => t.nick === nick);
  if (index !== -1) {
    const tempoAtualMs = tempoParaMs(dados.tempos[index].tempo);
    if (novoMs < tempoAtualMs) {
      dados.tempos[index].tempo      = tempo;
      dados.tempos[index].penalidade = (dados.tempos[index].penalidade || 0) + aplicarPenal + penPendente;
      message.reply("🟢 " + nick + " novo melhor tempo: " + tempo);
      verificarFastestLap(dados, nick, novoMs, sessao);
    } else {
      message.reply("⚠️ Seu tempo anterior era melhor: " + dados.tempos[index].tempo + ". Mantendo o anterior.");
      return;
    }
  } else {
    dados.tempos.push({ nick, tempo, penalidade: aplicarPenal + penPendente });
    message.reply("✅ " + nick + " seu tempo foi registrado: " + tempo + (penPendente ? " (inclui +" + penPendente + "s de penalidade pendente)" : ""));
    verificarFastestLap(dados, nick, novoMs, sessao);
  }
  salvarDados(dados);
}

async function handleBestLap(message, jogador) {
  const racemode = carregarRaceMode();
  const gpAtual  = racemode.current_gp ? racemode[racemode.current_gp] : null;
  if (!gpAtual) { message.reply("Nenhum GP ativo no momento. Aguarde um ADM iniciar com !racemode."); return; }
  const sessao = getSessaoAtual(gpAtual);
  const nick   = jogador.nick;
  if (sessao === "RACE") {
    const d = getDadosHoje();
    if (d.tempos.find(t => t.nick === nick)) { message.reply("🚫 Na corrida só é permitido enviar o tempo UMA vez."); return; }
  } else if (sessao === "ENCERRADO") {
    message.reply("⏱️ A sessão já encerrou. Tempo fora do horário, penalidade de 1 segundo aplicada!");
  } else if (sessao !== "QUALI") {
    message.reply("Ainda não é horário de envio de tempo.");
    return;
  }
  if (!message.hasMedia) { message.reply("Envie a imagem junto com o comando."); return; }
  const agora        = new Date();
  const raceEnd      = new Date(gpAtual.race_end);
  const aplicarPenal = agora > raceEnd ? 1 : 0;
  if (aplicarPenal) message.reply("Tempo enviado fora do horário da corrida, penalidade de 1 segundo aplicada!");
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir);
  const media   = await message.downloadMedia();
  const buffer  = Buffer.from(media.data, "base64");
  const caminho = path.join(imgDir, "bestlap_tempo_" + nick + ".png");
  fs.writeFileSync(caminho, buffer);
  const tempo = await readD(caminho);
  if (!tempo) { message.reply("Não consegui ler o tempo da imagem. Tente novamente."); return; }
  const pend        = carregarPenPendentes();
  const penPendente = pend[nick.toLowerCase()] || 0;
  if (penPendente) { delete pend[nick.toLowerCase()]; salvarPenPendentes(pend); }
  aguardandoComprovacao[message.author] = { nick, tempo, caminhoTempo: caminho, penalidade: aplicarPenal + penPendente };
  message.reply("✅ Tempo lido: *" + tempo + "*\n📸 Agora envie a foto de comprovação (sem comando).");
}

function cancelarTimers() {
  if (timerAbreQuali) { clearTimeout(timerAbreQuali); timerAbreQuali = null; }
  if (timerFimQuali)  { clearTimeout(timerFimQuali);  timerFimQuali  = null; }
  if (timerGridQuali) { clearTimeout(timerGridQuali); timerGridQuali = null; }
  if (timerAbreRace)  { clearTimeout(timerAbreRace);  timerAbreRace  = null; }
  if (timerFimRace)   { clearTimeout(timerFimRace);   timerFimRace   = null; }
}

function agendarTimers(gpAtual, nomeGP) {
  cancelarTimers();
  const agora          = new Date();
  const qualyStart     = new Date(gpAtual.qualy_start);
  const qualyEnd       = new Date(gpAtual.qualy_end);
  const raceStart      = new Date(gpAtual.race_start);
  const raceEnd        = new Date(gpAtual.race_end);
  const msAteQualyStart = qualyStart.getTime() - agora.getTime();
  const msAteQualyEnd  = qualyEnd.getTime()  - agora.getTime();
  const msAteRaceStart = raceStart.getTime() - agora.getTime();
  const msAteRaceEnd   = raceEnd.getTime()   - agora.getTime();
  if (msAteQualyStart > 0) {
    timerAbreQuali = setTimeout(() => {
      const rm = carregarRaceMode();
      if (!rm.current_gp) return;
      client.sendMessage(QUALI_GROUP_ID, "🟢 *QUALI ABERTA! GP " + nomeGP + "*\nEnviem seus tempos com !tempo ou !bestlap. Boa sorte! 🏎️");
    }, msAteQualyStart);
  } else {
    // Quali já em andamento quando o bot iniciou/GP foi criado
    client.sendMessage(QUALI_GROUP_ID, "🟢 *QUALI ABERTA! GP " + nomeGP + "*\nEnviem seus tempos com !tempo ou !bestlap. Boa sorte! 🏎️");
  }
  if (msAteQualyEnd > 0) {
    timerFimQuali = setTimeout(async () => {
      const rm = carregarRaceMode();
      if (!rm.current_gp) return;
      client.sendMessage(QUALI_GROUP_ID, "🏁 *SESSÃO DE QUALIFICAÇÃO ENCERRADA!*\nOs comissários estão revisando os tempos. Em 10 minutos teremos o Grid de Largada oficial.");
      timerGridQuali = setTimeout(async () => {
        const rm2 = carregarRaceMode();
        if (!rm2.current_gp) return;
        await gerarTabelaQuali(nomeGP);
        salvarDados({ data: new Date().toISOString().split("T")[0], tempos: [] });
        client.sendMessage(QUALI_GROUP_ID, "🧹 *DADOS LIMPOS!* O sistema está pronto para receber os tempos da CORRIDA.");
      }, 10 * 60 * 1000);
    }, msAteQualyEnd);
  }
  if (msAteRaceStart > 0) {
    timerAbreRace = setTimeout(() => {
      const rm = carregarRaceMode();
      if (!rm.current_gp) return;
      client.sendMessage(TEMPO_GROUP_ID, "🏁 *CORRIDA ABERTA! GP " + nomeGP + "*\nEnviem seus tempos com !tempo ou !bestlap. Boa corrida! 🏎️");
    }, msAteRaceStart);
  }
  if (msAteRaceEnd > 0) {
    timerFimRace = setTimeout(() => {
      const rm = carregarRaceMode();
      if (!rm.current_gp) return;
      client.sendMessage(TEMPO_GROUP_ID, "🏁 *CORRIDA ENCERRADA!* Aguardem o resultado oficial do ADM.");
    }, msAteRaceEnd);
  }
}

function reagendarTimersSeNecessario() {
  const racemode = carregarRaceMode();
  if (!racemode.current_gp) return;
  const gpAtual = racemode[racemode.current_gp];
  if (!gpAtual) return;
  const agora   = new Date();
  const raceEnd = new Date(gpAtual.race_end);
  if (agora > raceEnd) return;
  console.log("Reagendando timers para GP: " + racemode.current_gp);
  agendarTimers(gpAtual, racemode.current_gp);
}

function jsonParaCSV(dados) {
  if (!dados.tempos || dados.tempos.length === 0) return "";
  const participantes = carregarParticipantes();
  const ordenados     = ordenarTempos(dados.tempos);
  const linhas        = ["Posicao,Nome,Nick,Equipe,Tempo,Penalidade"];
  ordenados.forEach((t, i) => {
    const p      = participantes.find(x => x.nick === t.nick);
    const nome   = p ? p.nome : t.nick;
    const equipe = p ? p.equipe : "N/D";
    linhas.push((i + 1) + "," + nome + "," + t.nick + "," + equipe + "," + t.tempo + "," + (t.penalidade || 0));
  });
  return linhas.join("\n");
}

function jsonParaTXT(dados) {
  if (!dados.tempos || dados.tempos.length === 0) return "Nenhum tempo registrado.";
  const participantes = carregarParticipantes();
  const ordenados     = ordenarTempos(dados.tempos);
  let texto           = "🏁 Tabela de Tempos - " + dados.data + "\n\n";
  ordenados.forEach((t, i) => {
    const p      = participantes.find(x => x.nick === t.nick);
    const nome   = p ? p.nome : t.nick;
    const equipe = p ? p.equipe : "N/D";
    texto += "P" + (i + 1) + " - " + nome + " (" + equipe + ")\nTempo: " + t.tempo + "\nPenalidade: " + (t.penalidade || 0) + "s\n----------------\n";
  });
  return texto;
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "bot-fr" }),
  puppeteer: {
    executablePath: "/usr/bin/chromium-browser",
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu","--no-zygote","--single-process"]
  }
});

client.on("qr", qr => qrcode.generate(qr, { small: true }));
client.on("ready", () => { console.log("Bot ready"); reagendarTimersSeNecessario(); });

client.on("message", async message => {
  if (!isGP(message)) return;
  const id    = message.author;
  const texto = message.body ? message.body.trim().toLowerCase() : "";

  // ── Foto de comprovação do bestlap ────────────────────────────────────────
  if (aguardandoComprovacao[id] && message.hasMedia && !texto.startsWith("!")) {
    const entrada     = aguardandoComprovacao[id];
    const caminhoComp = path.join(imgDir, "bestlap_comp_" + entrada.nick + ".png");
    const media       = await message.downloadMedia();
    fs.writeFileSync(caminhoComp, Buffer.from(media.data, "base64"));
    const pend = carregarBestlapPend();
    pend[entrada.nick.toLowerCase()] = { nick: entrada.nick, tempo: entrada.tempo, penalidade: entrada.penalidade, caminhoTempo: entrada.caminhoTempo, caminhoComp };
    salvarBestlapPend(pend);
    const participantes = carregarParticipantes();
    const jogador       = participantes.find(p => p.nick === entrada.nick);
    const nomeExibido   = jogador ? jogador.nome : entrada.nick;
    const equipe        = jogador ? jogador.equipe : "N/D";
    await client.sendMessage(SOLICITACOES_GROUP_ID,
      "📋 *SOLICITAÇÃO DE BESTLAP*\n" +
      "👤 Piloto: " + nomeExibido + " (" + entrada.nick + ")\n" +
      "🏎️ Equipe: " + equipe + "\n" +
      "⏱️ Tempo: *" + entrada.tempo + "*\n\n" +
      "Use *!aprovar " + entrada.nick + "* para confirmar ou *!remover " + entrada.nick + "* para rejeitar."
    );
    await client.sendMessage(SOLICITACOES_GROUP_ID, MessageMedia.fromFilePath(entrada.caminhoTempo));
    await client.sendMessage(SOLICITACOES_GROUP_ID, MessageMedia.fromFilePath(caminhoComp));
    delete aguardandoComprovacao[id];
    message.reply("📨 Solicitação enviada aos comissários! Aguarde a aprovação.");
    return;
  }

  // ── Registro pendente ──────────────────────────────────────────────────────
  if (registrosPendentes[id]) {
    const etapa = registrosPendentes[id].etapa;
    const dados = registrosPendentes[id];
    const input = message.body.trim();
    if (etapa === "nick") {
      const participantes = carregarParticipantes();
      if (participantes.find(p => p.nick.toLowerCase() === input.toLowerCase())) { message.reply("❌ Esse nick já está em uso. Digite outro nick:"); return; }
      dados.nick = input; dados.etapa = "nome";
      message.reply("Digite seu nome completo:\n*(lembre-se de colocar a bandeira)*");
      return;
    }
    if (etapa === "nome") {
      const participantes = carregarParticipantes();
      if (participantes.find(p => p.nome.toLowerCase() === input.toLowerCase())) { message.reply("❌ Já existe um piloto com esse nome. Por favor adicione seu sobrenome:"); return; }
      dados.nome = input; dados.etapa = "equipe";
      message.reply("Digite o número da sua equipe:\n" + listarEquipes());
      return;
    }
    if (etapa === "equipe") {
      const equipes = carregarEquipes();
      const num     = parseInt(input);
      if (isNaN(num) || num < 1 || num > equipes.length) { message.reply("❌ Número inválido. Escolha um número da lista:\n" + listarEquipes()); return; }
      dados.equipe = equipes[num - 1];
      const participantes = carregarParticipantes();
      if (!participantes.find(p => p.id === id)) {
        participantes.push({ id, nick: dados.nick, nome: dados.nome, equipe: dados.equipe });
        await salvarParticipantes(participantes);
        message.reply("✅ Registro concluído!\nNick: " + dados.nick + "\nNome: " + dados.nome + "\nEquipe: " + dados.equipe + "\n\nUse !credencial para verificar seus dados.");
      } else { message.reply("Você já está registrado."); }
      delete registrosPendentes[id];
      return;
    }
  }

  // ── Edição pendente ────────────────────────────────────────────────────────
  if (edicoesPendentes[id]) {
    const etapa  = edicoesPendentes[id].etapa;
    const dados  = edicoesPendentes[id].dados;
    const input  = message.body.trim();
    const manter = input === "-";
    if (etapa === "nick") {
      if (!manter) {
        const participantes = carregarParticipantes();
        if (participantes.find(p => p.nick.toLowerCase() === input.toLowerCase() && p.id !== id)) { message.reply("❌ Esse nick já está em uso. Digite outro ou '-' para manter:"); return; }
        const dadosAtivos = carregarDados();
        if (dadosAtivos) { const reg = dadosAtivos.tempos.find(t => t.nick === dados.nick); if (reg) { reg.nick = input; salvarDados(dadosAtivos); } }
        dados.nick = input;
      }
      edicoesPendentes[id].etapa = "nome";
      message.reply("Digite seu novo nome ou '-' para manter:");
      return;
    }
    if (etapa === "nome") {
      if (!manter) {
        const participantes = carregarParticipantes();
        if (participantes.find(p => p.nome.toLowerCase() === input.toLowerCase() && p.id !== id)) { message.reply("❌ Já existe um piloto com esse nome. Adicione sobrenome ou '-' para manter:"); return; }
        dados.nome = input;
      }
      edicoesPendentes[id].etapa = "equipe";
      message.reply("Digite o número da nova equipe ou '-' para manter:\n" + listarEquipes());
      return;
    }
    if (etapa === "equipe") {
      if (!manter) {
        const equipes = carregarEquipes();
        const num     = parseInt(input);
        if (isNaN(num) || num < 1 || num > equipes.length) { message.reply("❌ Número inválido. Escolha da lista ou '-' para manter:\n" + listarEquipes()); return; }
        dados.equipe = equipes[num - 1];
      }
      const participantes = carregarParticipantes();
      const index         = participantes.findIndex(p => p.id === id);
      if (index !== -1) {
        participantes[index] = dados;
        await salvarParticipantes(participantes);
        message.reply("✅ Cadastro atualizado!\nNick: " + dados.nick + "\nNome: " + dados.nome + "\nEquipe: " + dados.equipe);
      } else { message.reply("Erro: participante não encontrado."); }
      delete edicoesPendentes[id];
      return;
    }
  }

  // ── Ban trap ───────────────────────────────────────────────────────────────
  if (texto.split(" ").includes("ban")) {
    message.reply("Mermão saporra de comando não existe, para de tentar dar ban seu infitetico\nEu sou o bot e não aguento mais porraaaaa");
    return;
  }

  if (texto.startsWith("!racemode")) {
    if (!isAdmin(message)) { message.reply("Você não tem permissão pra usar esse comando."); return; }
    const partes = message.body.split(" ");
    const gpSet  = partes.slice(1).join(" ").toUpperCase();
    if (!gpSet)  { message.reply("Use: !racemode NOME_DO_GP"); return; }
    const racemode = carregarRaceMode();
    if (racemode.current_gp) { message.reply("⚠️ Já existe um GP ativo: *" + racemode.current_gp + "*\nUse !endgp antes de iniciar um novo."); return; }
    const agora      = new Date();
    const qualyStart = new Date(agora);
    qualyStart.setHours(12, 0, 0, 0);
    const qualyEnd  = new Date(qualyStart.getTime() + 24 * 60 * 60 * 1000);
    const raceStart = new Date(qualyEnd.getTime()   + 1  * 60 * 60 * 1000);
    const raceEnd   = new Date(raceStart.getTime()  + 24 * 60 * 60 * 1000);
    racemode[gpSet] = { qualy_start: qualyStart.toISOString(), qualy_end: qualyEnd.toISOString(), race_start: raceStart.toISOString(), race_end: raceEnd.toISOString() };
    racemode.current_gp = gpSet;
    salvarRaceMode(racemode);
    agendarTimers(racemode[gpSet], gpSet);
    const form = qualyStart.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    message.reply("🏁 *Race mode iniciado: " + gpSet + "*\n🟢 Quali: 12h do dia " + form + " → 12h do dia " + addDay(qualyStart, 1) + "\n🏎️ Corrida: 13h do dia " + addDay(qualyStart, 1) + " → 13h do dia " + addDay(qualyStart, 2));
    return;
  }

  if (texto.startsWith("!endgp")) {
    if (!isAdmin(message)) { message.reply("Apenas ADM pode encerrar um GP."); return; }
    const racemode = carregarRaceMode();
    if (!racemode.current_gp) { message.reply("Nenhum GP ativo para encerrar."); return; }
    await gerarResultado(message);
    cancelarTimers();
    delete racemode[racemode.current_gp];
    delete racemode.current_gp;
    salvarRaceMode(racemode);
    message.reply("✅ GP encerrado! Use !data para exportar os dados da corrida.");
    return;
  }

  if (texto.startsWith("!data")) {
    if (!isAdmin(message)) { message.reply("Apenas ADM pode solicitar os dados."); return; }
    const dados = carregarDados();
    if (!dados || dados.tempos.length === 0) { message.reply("Nenhum dado registrado ainda."); return; }
    const partes  = message.body.split(" ");
    const formato = partes[1] ? partes[1].toLowerCase() : "msg";
    if (formato === "csv") { fs.writeFileSync("./dados.csv", jsonParaCSV(dados)); await message.reply(MessageMedia.fromFilePath("./dados.csv")); }
    else if (formato === "txt") { fs.writeFileSync("./dados.txt", jsonParaTXT(dados)); await message.reply(MessageMedia.fromFilePath("./dados.txt")); }
    else { message.reply(jsonParaTXT(dados)); }
    salvarDados({ data: new Date().toISOString().split("T")[0], tempos: [] });
    limparImg();
    message.reply("🧹 Dados e imagens limpos.");
    return;
  }

  if (texto.startsWith("!credencial")) {
    const participantes = carregarParticipantes();
    const jogador       = participantes.find(p => p.id === id);
    if (!jogador) { message.reply("Você ainda não possui cadastro. Use !registrar."); return; }
    message.reply("🆔 *Credencial*\nNick: " + jogador.nick + "\nNome: " + jogador.nome + "\nEquipe: " + jogador.equipe);
    return;
  }

  if (texto === "!mylap") {
    const participantes = carregarParticipantes();
    const jogador       = participantes.find(p => p.id === id);
    if (!jogador) { message.reply("Você ainda não está registrado. Use !registrar."); return; }
    const dados = carregarDados();
    if (!dados || dados.tempos.length === 0) { message.reply("Nenhum tempo registrado ainda."); return; }
    const registro = dados.tempos.find(t => t.nick === jogador.nick);
    if (!registro) { message.reply("Você ainda não enviou nenhum tempo nessa sessão."); return; }
    const ordenados = ordenarTempos(dados.tempos);
    const posicao   = ordenados.findIndex(t => t.nick === jogador.nick) + 1;
    const ms        = tempoParaMs(registro.tempo) + (registro.penalidade || 0) * 1000;
    const pen       = registro.penalidade ? " (+" + registro.penalidade + "s)" : "";
    message.reply("⏱️ *Seu tempo:* " + msParaTempo(ms) + pen + "\n📍 *Posição atual:* P" + posicao + " de " + ordenados.length);
    return;
  }

  if (texto.startsWith("!gap ")) {
    const participantes = carregarParticipantes();
    const jogador       = participantes.find(p => p.id === id);
    if (!jogador) { message.reply("Você precisa estar registrado. Use !registrar."); return; }
    const dados = carregarDados();
    if (!dados || dados.tempos.length === 0) { message.reply("Nenhum tempo registrado ainda."); return; }
    const meuRegistro = dados.tempos.find(t => t.nick === jogador.nick);
    if (!meuRegistro) { message.reply("Você ainda não enviou nenhum tempo nessa sessão."); return; }
    const posAlvo = parseInt(message.body.split(" ")[1]);
    if (isNaN(posAlvo) || posAlvo < 1) { message.reply("Use: !gap POSICAO\nEx: !gap 1"); return; }
    const ordenados = ordenarTempos(dados.tempos);
    if (posAlvo > ordenados.length) { message.reply("Só há " + ordenados.length + " pilotos na sessão."); return; }
    const alvo     = ordenados[posAlvo - 1];
    const meuMs    = tempoParaMs(meuRegistro.tempo) + (meuRegistro.penalidade || 0) * 1000;
    const alvoMs   = tempoParaMs(alvo.tempo)         + (alvo.penalidade         || 0) * 1000;
    const diff     = meuMs - alvoMs;
    const pAlvo    = participantes.find(x => x.nick === alvo.nick);
    message.reply("📊 *Gap para P" + posAlvo + " (" + (pAlvo ? pAlvo.nome : alvo.nick) + "):* " + (diff >= 0 ? "+" : "-") + msParaTempo(Math.abs(diff)));
    return;
  }

  if (texto.startsWith("!gapto ")) {
    const participantes = carregarParticipantes();
    const jogador       = participantes.find(p => p.id === id);
    if (!jogador) { message.reply("Você precisa estar registrado. Use !registrar."); return; }
    const dados = carregarDados();
    if (!dados || dados.tempos.length === 0) { message.reply("Nenhum tempo registrado ainda."); return; }
    const meuRegistro = dados.tempos.find(t => t.nick === jogador.nick);
    if (!meuRegistro) { message.reply("Você ainda não enviou nenhum tempo nessa sessão."); return; }
    const nomeAlvo = message.body.split(" ").slice(1).join(" ").trim();
    if (!nomeAlvo) { message.reply("Use: !gapto NOME\nEx: !gapto Daniel Silva"); return; }
    const pAlvo = participantes.find(p => p.nome.toLowerCase() === nomeAlvo.toLowerCase());
    if (!pAlvo) { message.reply("Piloto \"" + nomeAlvo + "\" não encontrado."); return; }
    const regAlvo = dados.tempos.find(t => t.nick === pAlvo.nick);
    if (!regAlvo) { message.reply(nomeAlvo + " ainda não enviou tempo nessa sessão."); return; }
    const meuMs  = tempoParaMs(meuRegistro.tempo) + (meuRegistro.penalidade || 0) * 1000;
    const alvoMs = tempoParaMs(regAlvo.tempo)      + (regAlvo.penalidade      || 0) * 1000;
    const diff   = meuMs - alvoMs;
    message.reply("📊 *Gap para " + nomeAlvo + ":* " + (diff >= 0 ? "+" : "-") + msParaTempo(Math.abs(diff)));
    return;
  }

  if (texto === "!campeonato") {
    const camp    = carregarCampeonato();
    const pilotos = Object.entries(camp.pilotos).sort((a, b) => b[1].pontos - a[1].pontos);
    if (pilotos.length === 0) { message.reply("Nenhum ponto registrado ainda."); return; }
    let resposta = "🏆 *CAMPEONATO DE PILOTOS*\n\n";
    pilotos.forEach(([nome, d], i) => { resposta += (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i+1)+"º") + " " + nome + " (*" + d.equipe + "*) — " + d.pontos + " pts\n"; });
    message.reply(resposta);
    return;
  }

  if (texto === "!construtores") {
    const camp    = carregarCampeonato();
    const equipes = Object.entries(camp.equipes).sort((a, b) => b[1].pontos - a[1].pontos);
    if (equipes.length === 0) { message.reply("Nenhum ponto registrado ainda."); return; }
    let resposta = "🏗️ *CAMPEONATO DE CONSTRUTORES*\n\n";
    equipes.forEach(([equipe, d], i) => { resposta += (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i+1)+"º") + " " + equipe + " — " + d.pontos + " pts\n"; });
    message.reply(resposta);
    return;
  }

  if (texto === "!grid") {
    const participantes = carregarParticipantes();
    const equipes       = carregarEquipes();
    if (participantes.length === 0) { message.reply("Nenhum piloto registrado ainda."); return; }
    let resposta = "🏗️ *GRID DE EQUIPES*\n\n";
    equipes.forEach(equipe => {
      const pilotos = participantes.filter(p => p.equipe === equipe);
      if (pilotos.length === 0) return;
      resposta += "*" + equipe + "*\n";
      pilotos.forEach(p => { resposta += "  • " + p.nome + " (" + p.nick + ")\n"; });
      resposta += "--------------------\n";
    });
    const semEquipe = participantes.filter(p => !equipes.includes(p.equipe));
    if (semEquipe.length > 0) { resposta += "*Sem equipe*\n"; semEquipe.forEach(p => { resposta += "  • " + p.nome + " (" + p.nick + ")\n"; }); }
    message.reply(resposta);
    return;
  }

  if (texto.startsWith("!stats")) {
    const nick = message.body.split(" ").slice(1).join(" ").trim();
    if (!nick) { message.reply("Use: !stats NICK"); return; }
    const participantes = carregarParticipantes();
    const jogador       = participantes.find(p => p.nick.toLowerCase() === nick.toLowerCase());
    if (!jogador) { message.reply("Piloto \"" + nick + "\" não encontrado."); return; }
    const historico = carregarHistorico();
    const camp      = carregarCampeonato();
    const corridas  = historico.filter(h => h.resultado.find(r => r.nome === jogador.nome));
    if (corridas.length === 0) { message.reply(jogador.nome + " ainda não participou de nenhuma corrida."); return; }
    let vitorias = 0, podios = 0, totalPontos = 0;
    corridas.forEach(h => { const r = h.resultado.find(x => x.nome === jogador.nome); if (!r) return; if (r.posicao === 1) vitorias++; if (r.posicao <= 3) podios++; totalPontos += r.pontos; });
    const posicaoCamp = Object.entries(camp.pilotos).sort((a, b) => b[1].pontos - a[1].pontos).findIndex(([nome]) => nome === jogador.nome) + 1;
    message.reply("📊 *Stats de " + jogador.nome + "*\nEquipe: " + jogador.equipe + "\nCorridas: " + corridas.length + "\nVitórias: " + vitorias + "\nPódios: " + podios + "\nPontos totais: " + totalPontos + "\nPosição no campeonato: P" + posicaoCamp);
    return;
  }

  if (texto === "!registrar") {
    if (message.from !== REGISTRO_GROUP_ID) { message.reply("Use o grupo de registro para essa função."); return; }
    const participantes = carregarParticipantes();
    if (participantes.find(p => p.id === id)) { message.reply("Você já está registrado!"); return; }
    const equipes = carregarEquipes();
    if (equipes.length === 0) { message.reply("Nenhuma equipe cadastrada ainda. Aguarde o ADM configurar as equipes."); return; }
    registrosPendentes[id] = { etapa: "nick" };
    message.reply("Vamos registrar você! Digite seu nick de jogo:");
    return;
  }

  if (texto === "!editar") {
    if (message.from !== REGISTRO_GROUP_ID) { message.reply("Use o grupo de registro para essa função."); return; }
    const participantes = carregarParticipantes();
    const jogador       = participantes.find(p => p.id === id);
    if (!jogador) { message.reply("Você ainda não está registrado! Use !registrar primeiro."); return; }
    edicoesPendentes[id] = { etapa: "nick", dados: { ...jogador } };
    message.reply("✏️ Edição iniciada.\nDigite seu novo nick ou '-' para manter:");
    return;
  }

  if (texto === "!adm") {
    if (!ADM_IDS.includes(message.author)) { ADM_IDS.push(message.author); salvarAdms(ADM_IDS); message.reply("Você foi registrado como administrador!"); }
    else { message.reply("Você já é um administrador."); }
    return;
  }

  if (texto === "!menu") { mostrarMenu(message); return; }

  if (texto.startsWith("!pen")) {
    if (!isAdmin(message)) { message.reply("Você não tem permissão pra usar esse comando."); return; }
    await aplicarPenalidade(message); return;
  }

  if (texto.startsWith("!unpen")) {
    if (!isAdmin(message)) { message.reply("Você não tem permissão pra usar esse comando."); return; }
    await removerPenalidade(message); return;
  }

  if (texto.startsWith("!aprovar")) {
    if (!isComissario(message)) { message.reply("Apenas comissários podem aprovar bestlaps."); return; }
    await aprovarBestlap(message); return;
  }

  if (texto.startsWith("!remover")) {
    if (!isComissario(message)) { message.reply("Apenas comissários podem remover tempos."); return; }
    await removerTempo(message); return;
  }

  if (texto.startsWith("!tabela")) { await gerarTabela(message); return; }

  if (texto.startsWith("!tempo")) {
    const racemode       = carregarRaceMode();
    const gpAtual        = racemode.current_gp ? racemode[racemode.current_gp] : null;
    const sessao         = getSessaoAtual(gpAtual);
    if (sessao === "QUALI" || sessao === "RACE") {
      const grupoPermitido = sessao === "QUALI" ? QUALI_GROUP_ID : TEMPO_GROUP_ID;
      if (message.from !== grupoPermitido) { message.reply("Use o grupo correto para enviar tempos."); return; }
    }
    const participantes = carregarParticipantes();
    const jogador       = participantes.find(p => p.id === id);
    if (!jogador) { message.reply("Você precisa se registrar primeiro com !registrar."); return; }
    await handleTempo(message, jogador); return;
  }

  if (texto.startsWith("!bestlap")) {
    const racemode       = carregarRaceMode();
    const gpAtual        = racemode.current_gp ? racemode[racemode.current_gp] : null;
    const sessao         = getSessaoAtual(gpAtual);
    if (sessao === "QUALI" || sessao === "RACE") {
      const grupoPermitido = sessao === "QUALI" ? QUALI_GROUP_ID : TEMPO_GROUP_ID;
      if (message.from !== grupoPermitido) { message.reply("Use o grupo correto para enviar tempos."); return; }
    }
    const participantes = carregarParticipantes();
    const jogador       = participantes.find(p => p.id === id);
    if (!jogador) { message.reply("Você precisa se registrar primeiro com !registrar."); return; }
    await handleBestLap(message, jogador); return;
  }

  if (texto.startsWith("!")) { mostrarMenuErro(message); return; }
});

client.initialize();

const express = require("express");
const app     = express();
app.get("/", (_, res) => res.send("Bot rodando"));
app.listen(process.env.PORT || 3000);
