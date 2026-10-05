import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

const API = "https://SEU-SERVIDOR-TTS.example.com"; // troque pela URL do servidor
const KEY = "livro-audio-v1";

const $ = s => document.querySelector(s);
const els = {
  file: $("#fileInput"), drop: $("#dropzone"), info: $("#fileInfo"),
  start: $("#startBtn"), resume: $("#resumeBtn"), reset: $("#resetBtn"),
  status: $("#statusCard"), statusTitle: $("#statusTitle"), statusText: $("#statusText"),
  badge: $("#statusBadge"), bar: $("#progressBar"), chaptersCard: $("#chaptersCard"),
  chapters: $("#chapters"), bookTitle: $("#bookTitle"), chapterCount: $("#chapterCount")
};
let state = JSON.parse(localStorage.getItem(KEY) || "null");
let currentFile = null;

function save(){ localStorage.setItem(KEY, JSON.stringify(state)); updateButtons(); }
function updateButtons(){
  const hasFile = !!state?.fileName && Array.isArray(state?.chapters);
  els.start.disabled = !hasFile;
  els.resume.disabled = !hasFile || !state.chapters.some(c => !c.audioUrl);
}
function setStatus(title,text,percent,badge="Processando"){
  els.status.classList.remove("hidden"); els.statusTitle.textContent=title;
  els.statusText.textContent=text; els.bar.style.width=percent+"%"; els.badge.textContent=badge;
}
function normalizeText(s){
  return s.replace(/\u00ad/g,"")
    .replace(/\r/g,"\n").replace(/[ \t]+\n/g,"\n")
    .replace(/\n{3,}/g,"\n\n")
    .replace(/(\p{L})-\n(?=\p{L})/gu,"$1")
    .replace(/\n(?=\p{Ll})/gu," ")
    .replace(/[ \t]{2,}/g," ")
    .replace(/\s+([,.;:!?])/g,"$1")
    .replace(/([,.;:!?])([A-Za-zÀ-ÿ])/g,"$1 $2")
    .replace(/([(\[])\s+/g,"$1").replace(/\s+([)\]])/g,"$1")
    .trim();
}
function looksLikeHeaderFooter(lines){
  const nonempty=lines.filter(Boolean);
  if(nonempty.length<8)return new Set();
  const first=nonempty.slice(0,Math.min(12,nonempty.length));
  const last=nonempty.slice(-Math.min(12,nonempty.length));
  const candidates=new Set();
  for(const l of [...first,...last]){
    const t=l.trim();
    if(/^\d{1,5}$/.test(t)||/^(página|page)\s*\d+$/i.test(t)||/^(www\.|http)/i.test(t)) candidates.add(t);
  }
  return candidates;
}
function cleanPrintArtifacts(text){
  let lines=text.split("\n").map(x=>x.trim()).filter(Boolean);
  const junk=looksLikeHeaderFooter(lines);
  lines=lines.filter(l=>!junk.has(l));
  lines=lines.filter(l=>!/^\s*[-–—]?\s*\d+\s*[-–—]?\s*$/.test(l));
  return normalizeText(lines.join("\n"));
}
function splitLong(text,max=5000){
  const out=[]; let rest=text;
  while(rest.length>max){
    let cut=Math.max(rest.lastIndexOf(". ",max),rest.lastIndexOf("! ",max),rest.lastIndexOf("? ",max),rest.lastIndexOf("\n",max));
    if(cut<Math.floor(max*.55))cut=max;
    out.push(rest.slice(0,cut+1).trim()); rest=rest.slice(cut+1).trim();
  }
  if(rest)out.push(rest); return out;
}
function detectChapters(text){
  const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const patterns=[
    /^(cap[ií]tulo|chapter)\s+[\divxlc0-9]+/i,
    /^(cap[ií]tulo|chapter)\b/i,
    /^(parte|part)\s+[\divxlc0-9]+/i,
    /^(pr[óo]logo|pref[áa]cio|introdu[cç][aã]o|ep[ií]logo|conclus[aã]o)\b/i
  ];
  const idx=[];
  lines.forEach((l,i)=>{if(patterns.some(p=>p.test(l)) || (/^\d+[\.\-–—]\s+\S/.test(l)&&l.length<120))idx.push(i)});
  if(idx.length>=2){
    return idx.map((start,n)=>({title:lines[start],text:lines.slice(start+1,idx[n+1]??lines.length).join("\n")})).filter(c=>c.text.length>100);
  }
  // fallback: títulos curtos isolados por linhas em caixa alta
  const alt=[]; lines.forEach((l,i)=>{if(l.length>3&&l.length<100&&/^[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ0-9 .,:;—–\-]+$/.test(l)&&i<lines.length-1)alt.push(i)});
  if(alt.length>=2)return alt.map((start,n)=>({title:lines[start],text:lines.slice(start+1,alt[n+1]??lines.length).join("\n")})).filter(c=>c.text.length>100);
  return splitLong(text,12000).map((t,i)=>({title:`Parte ${i+1}`,text:t}));
}
async function parseTxt(file){return cleanPrintArtifacts(await file.text())}
async function parseHtml(file){
  const html=await file.text(), doc=new DOMParser().parseFromString(html,"text/html");
  doc.querySelectorAll("script,style,noscript,nav,header,footer").forEach(x=>x.remove());
  return cleanPrintArtifacts(doc.body?.innerText||doc.documentElement.innerText);
}
async function parseDocx(file){
  const buf=await file.arrayBuffer(), r=await window.mammoth.extractRawText({arrayBuffer:buf});
  return cleanPrintArtifacts(r.value);
}
async function parsePdf(file){
  const data=new Uint8Array(await file.arrayBuffer());
  const pdf=await pdfjsLib.getDocument({data}).promise; let pages=[];
  for(let i=1;i<=pdf.numPages;i++){
    const p=await pdf.getPage(i), c=await p.getTextContent();
    pages.push(c.items.map(x=>x.str).join(" "));
    setStatus("Lendo PDF",`Página ${i} de ${pdf.numPages}`,Math.round(i/pdf.numPages*35),"Extração");
  }
  return cleanPrintArtifacts(pages.join("\n\n"));
}
async function parseEpub(file){
  const zip=await JSZip.loadAsync(await file.arrayBuffer());
  const container=await zip.file("META-INF/container.xml").async("text");
  const cd=new DOMParser().parseFromString(container,"application/xml");
  const root=cd.querySelector("rootfile")?.getAttribute("full-path");
  if(!root)throw Error("EPUB sem container.xml válido.");
  const opf=await zip.file(root).async("text"), od=new DOMParser().parseFromString(opf,"application/xml");
  const base=root.split("/").slice(0,-1).join("/");
  const manifest=new Map([...od.querySelectorAll("manifest > item")].map(x=>[x.getAttribute("id"),x.getAttribute("href")]));
  const spine=[...od.querySelectorAll("spine > itemref")].map(x=>manifest.get(x.getAttribute("idref"))).filter(Boolean);
  let text="";
  for(const href of spine){
    const path=(base?base+"/":"")+decodeURIComponent(href).split("#")[0];
    const f=zip.file(path)||zip.file(path.replace(/^\//,""));
    if(!f)continue;
    const html=await f.async("text"), doc=new DOMParser().parseFromString(html,"text/html");
    doc.querySelectorAll("script,style,nav").forEach(x=>x.remove());
    text += "\n\n"+(doc.body?.innerText||"");
  }
  return cleanPrintArtifacts(text);
}
async function parseBook(file){
  const ext=file.name.toLowerCase().split(".").pop();
  if(ext==="txt")return parseTxt(file);
  if(ext==="html"||ext==="htm")return parseHtml(file);
  if(ext==="docx")return parseDocx(file);
  if(ext==="pdf")return parsePdf(file);
  if(ext==="epub")return parseEpub(file);
  throw Error("Formato não suportado. Use TXT, EPUB, PDF, HTML ou DOCX.");
}
function render(){
  if(!state)return;
  els.info.classList.remove("hidden"); els.info.textContent=`${state.fileName} · ${state.chapters.length} capítulos identificados`;
  els.chaptersCard.classList.remove("hidden"); els.bookTitle.textContent=state.fileName.replace(/\.[^.]+$/,"");
  els.chapterCount.textContent=`${state.chapters.length} capítulos`;
  els.chapters.innerHTML="";
  state.chapters.forEach((c,i)=>{
    const row=document.createElement("div"); row.className="chapter "+(c.audioUrl?"done":"");
    const label=c.audioUrl?`<a class="download" href="${c.audioUrl}" download="${c.fileName}">Baixar M4A</a>`:`<span class="state">${c.status||"Na fila"}</span>`;
    row.innerHTML=`<div class="num">${String(i+1).padStart(2,"0")}</div><div><h3>${escapeHtml(c.title)}</h3><p>${c.text.length.toLocaleString("pt-BR")} caracteres · voz ${i%2===0?"masculina":"feminina"}</p></div><div class="chapter-actions">${label}</div>`;
    els.chapters.appendChild(row);
  }); updateButtons();
}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

async function choose(file){
  currentFile=file; els.info.classList.remove("hidden"); els.info.textContent=`Lendo ${file.name}…`;
  try{
    const text=await parseBook(file); if(text.length<50)throw Error("Não foi possível encontrar texto suficiente no arquivo.");
    const chapters=detectChapters(text).map((c,i)=>({...c,index:i,status:"Na fila",audioUrl:null,fileName:`${String(i+1).padStart(2,"0")}-${slug(c.title)}.m4a`}));
    state={fileName:file.name,chapters,createdAt:Date.now()}; save(); render();
    setStatus("Livro pronto",`${chapters.length} capítulos identificados.`,100,"Pronto");
  }catch(e){setStatus("Não foi possível ler o livro",e.message,0,"Erro")}
}
function slug(s){return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,70)||"capitulo"}

async function generateFrom(startIndex){
  for(let i=startIndex;i<state.chapters.length;i++){
    const c=state.chapters[i]; if(c.audioUrl)continue;
    const voice=i%2===0?"male":"female";
    c.status="Gerando"; save(); render();
    setStatus(`Capítulo ${i+1} de ${state.chapters.length}`,`Gerando com voz ${voice==="male"?"Alessio":"Isabella"} · velocidade 0,8×`,Math.round(i/state.chapters.length*100));
    try{
      const chunks=splitLong(c.text,4500), blobs=[];
      for(let n=0;n<chunks.length;n++){
        const r=await fetch(`${API}/tts`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:chunks[n],voice,rate:"-20%"})});
        if(!r.ok)throw Error(await r.text());
        blobs.push(await r.blob());
        setStatus(`Capítulo ${i+1} de ${state.chapters.length}`,`Trecho ${n+1} de ${chunks.length}`,Math.round((i+n/chunks.length)/state.chapters.length*100));
      }
      // O servidor aceita texto inteiro em uma chamada; quando há chunking,
      // o endpoint retorna áudio compatível. A junção final de chunks é feita
      // no servidor em versões que habilitam /tts/batch. Para simplicidade,
      // usamos uma chamada por capítulo se o texto couber.
      if(chunks.length>1){
        const r=await fetch(`${API}/tts/batch`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chunks,voice,rate:"-20%"})});
        if(!r.ok)throw Error(await r.text());
        const b=await r.blob(); c.audioUrl=URL.createObjectURL(b);
      }else c.audioUrl=URL.createObjectURL(blobs[0]);
      c.status="Concluído"; save(); render();
    }catch(e){c.status=`Erro: ${e.message}`; save(); render(); setStatus("Processamento interrompido",`O capítulo ${i+1} não terminou. Use “Retomar de onde parou”.`,Math.round(i/state.chapters.length*100),"Pausado"); return}
  }
  setStatus("Livro concluído","Todos os capítulos foram gerados.",100,"Concluído");
}
els.file.addEventListener("change",e=>e.target.files[0]&&choose(e.target.files[0]));
["dragenter","dragover"].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.add("drag")}));
["dragleave","drop"].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.remove("drag")}));
els.drop.addEventListener("drop",e=>e.dataTransfer.files[0]&&choose(e.dataTransfer.files[0]));
els.start.addEventListener("click",()=>generateFrom(0));
els.resume.addEventListener("click",()=>generateFrom(state.chapters.findIndex(c=>!c.audioUrl)));
els.reset.addEventListener("click",()=>{if(confirm("Apagar o progresso e começar um novo livro?")){localStorage.removeItem(KEY);state=null;location.reload()}});
if(state)render();
