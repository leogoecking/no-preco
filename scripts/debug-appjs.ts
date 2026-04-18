import axios from 'axios';

async function main() {
  const { data } = await axios.get<string>(
    'https://precodahora.ba.gov.br/code/projeto/site/static/js/utils.js',
    {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0' },
      responseType: 'text',
      timeout: 15_000,
    },
  );

  // Pega 1000 chars depois do 'codmun' (o fim do objeto de parâmetros + a chamada ajax)
  const idx = data.indexOf("'codmun'");
  console.log('=== Após objeto de parâmetros (endpoint + chamada) ===');
  console.log(data.slice(idx + 300, idx + 1500));
}

main().catch(console.error);
