# Livro → Áudio

Aplicação web para:

- receber TXT, EPUB, PDF, HTML e DOCX;
- extrair o texto;
- limpar artefatos comuns de impressão;
- recompor palavras quebradas por fim de linha;
- identificar capítulos por marcações/títulos;
- gerar um capítulo por vez;
- alternar voz masculina/feminina;
- aplicar velocidade de 0,8×;
- gerar M4A;
- permitir download individual;
- salvar o progresso no navegador;
- retomar no primeiro capítulo ainda não concluído.

## Arquitetura

**Frontend:** GitHub Pages (arquivos `index.html`, `styles.css`, `app.js`).

**Backend:** Node/Express em um serviço que execute Node (Render, Railway, Fly.io, Cloud Run etc.). O backend chama o serviço de TTS e usa FFmpeg para transformar o áudio em M4A.

GitHub Pages é estático; ele não deve receber a chave secreta do Azure.

## Configuração

1. Publique o conteúdo da raiz em um repositório GitHub.
2. No `app.js`, altere:

```js
const API = "https://SEU-SERVIDOR-TTS.example.com";
```

para a URL pública do backend.

3. No diretório `server`:

```bash
npm install
```

4. Configure as variáveis do `.env` (ou as variáveis de ambiente do seu provedor):

```text
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=brazilsouth
VOICE_MALE=pt-BR-MacerioMultilingualNeural
VOICE_FEMALE=pt-BR-ThalitaMultilingualNeural
```

5. Execute:

```bash
npm start
```

## Sobre Alessio e Isabella

O código não afirma que Macerio/Thalita são Alessio/Isabella. Os nomes pedidos foram mantidos na interface, mas a API pública documentada do Azure atualmente lista outras vozes multilíngues pt-BR. Se você tiver um serviço que exponha as vozes Alessio e Isabella, basta colocar seus identificadores nas variáveis `VOICE_MALE` e `VOICE_FEMALE`.

## Observação sobre EPUB

O leitor usa a ordem do `spine` do EPUB. A identificação de capítulos tenta primeiro marcações como “Capítulo”, “Chapter”, “Parte”, “Prólogo”, etc.; quando isso não funciona, procura títulos isolados em caixa alta e, por último, divide o conteúdo em partes longas.

## Observação sobre limpeza

Nenhum algoritmo consegue identificar com 100% de certeza todo cabeçalho/rodapé de qualquer PDF. O código remove padrões comuns e números de página, mas livros com diagramação muito complexa podem exigir regras adicionais.

## Retomada

O estado dos capítulos fica em `localStorage` e os M4A concluídos ficam no **IndexedDB** do navegador. Assim, uma atualização da página não apaga os capítulos já concluídos. O botão “Retomar de onde parou” procura o primeiro capítulo que ainda não possui áudio.

Para uma biblioteca permanente e sincronizada entre dispositivos, a próxima evolução seria salvar os M4A também em armazenamento do servidor/S3/R2.
