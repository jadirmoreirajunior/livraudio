import express from "express";
import cors from "cors";
import {execFile} from "node:child_process";
import {promises as fs} from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const app=express();
app.use(cors());
app.use(express.json({limit:"2mb"}));

const PORT=process.env.PORT||3000;
const AZURE_KEY=process.env.AZURE_SPEECH_KEY;
const AZURE_REGION=process.env.AZURE_SPEECH_REGION||"brazilsouth";

/*
  IMPORTANT:
  Alessio/Isabella do Clipchamp não possuem, atualmente, identificadores públicos
  documentados na tabela de vozes do Azure Speech.
  Por isso, estes dois valores são configuráveis.
  Se você tiver um provedor/endpoint que realmente exponha Alessio e Isabella,
  substitua os valores abaixo pelo identificador desse provedor.
  Fallback Azure documentado: Macerio / Thalita Multilingual.
*/
const VOICES={
  male:process.env.VOICE_MALE||"pt-BR-MacerioMultilingualNeural",
  female:process.env.VOICE_FEMALE||"pt-BR-ThalitaMultilingualNeural"
};

function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

async function azureTTS(text,voice,rate="-20%"){
  if(!AZURE_KEY)throw Error("AZURE_SPEECH_KEY não configurada no servidor.");
  const url=`https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml=`<speak version="1.0" xml:lang="pt-BR"><voice name="${esc(voice)}"><prosody rate="${rate}">${esc(text)}</prosody></voice></speak>`;
  const r=await fetch(url,{method:"POST",headers:{
    "Ocp-Apim-Subscription-Key":AZURE_KEY,
    "Content-Type":"application/ssml+xml",
    "X-Microsoft-OutputFormat":"audio-24khz-160kbitrate-mono-mp3"
  },body:ssml});
  if(!r.ok)throw Error(`Azure TTS ${r.status}: ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

function runFFmpeg(input,output){
  return new Promise((resolve,reject)=>{
    execFile(ffmpegPath,["-y","-i",input,"-c:a","aac","-b:a","128k","-movflags","+faststart",output],(err,stdout,stderr)=>err?reject(Error(stderr||err.message)):resolve());
  });
}

async function makeM4A(buffers){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"livro-audio-"));
  try{
    const list=[];
    for(let i=0;i<buffers.length;i++){
      const p=path.join(dir,`part-${i}.mp3`);
      await fs.writeFile(p,buffers[i]);
      list.push(p);
    }
    // concat demuxer
    const concat=path.join(dir,"list.txt");
    await fs.writeFile(concat,list.map(p=>`file '${p.replaceAll("'","'\\''")}'`).join("\n"));
    const joined=path.join(dir,"joined.mp3");
    await new Promise((resolve,reject)=>execFile(ffmpegPath,["-y","-f","concat","-safe","0","-i",concat,"-c","copy",joined],(e,so,se)=>e?reject(Error(se||e.message)):resolve()));
    const out=path.join(dir,"audio.m4a");
    await runFFmpeg(joined,out);
    return await fs.readFile(out);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}

app.get("/health",(req,res)=>res.json({ok:true,voices:VOICES}));

app.post("/tts",async(req,res)=>{
  try{
    const {text,voice="male",rate="-20%"}=req.body||{};
    if(!text?.trim())return res.status(400).send("Texto vazio.");
    const id=voice==="female"?"female":"male";
    const mp3=await azureTTS(text,VOICES[id],rate);
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),"livro-one-"));
    try{
      const input=path.join(dir,"in.mp3"),out=path.join(dir,"out.m4a");
      await fs.writeFile(input,mp3); await runFFmpeg(input,out);
      res.type("audio/mp4").send(await fs.readFile(out));
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  }catch(e){res.status(500).send(e.message)}
});

app.post("/tts/batch",async(req,res)=>{
  try{
    const {chunks,voice="male",rate="-20%"}=req.body||{};
    if(!Array.isArray(chunks)||!chunks.length)return res.status(400).send("Nenhum trecho.");
    const id=voice==="female"?"female":"male";
    const buffers=[];
    for(const chunk of chunks)buffers.push(await azureTTS(chunk,VOICES[id],rate));
    res.type("audio/mp4").send(await makeM4A(buffers));
  }catch(e){res.status(500).send(e.message)}
});

app.listen(PORT,()=>console.log(`TTS server listening on ${PORT}`));
