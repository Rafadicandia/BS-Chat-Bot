const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { 
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote'
    ],
    headless: false,
    timeout: 0  // Sin timeout
  },
  authTimeoutMs: 0,  // Sin timeout de autenticación
  qrTimeoutMs: 0     // Sin timeout del QR
});

client.on('qr', (qr) => {
  console.log('\n📱 ESCANEA EL QR:\n');
  qrcode.generate(qr, { small: true });
  console.log('\n⏳ Esperando escaneo...\n');
});

client.on('loading_screen', (percent, message) => {
  console.log(`⏳ Cargando: ${percent}% - ${message}`);
});

client.on('authenticated', () => {
  console.log('✅ Autenticado - Cargando chats...');
});

client.on('ready', () => {
  console.log('\n✅✅✅ BOT COMPLETAMENTE LISTO ✅✅✅\n');
  console.log('📱 WhatsApp conectado exitosamente');
  console.log('💬 Envía "hola" desde otro número para probar\n');
});

client.on('message', async (msg) => {
  console.log(`📨 Mensaje de ${msg.from}: ${msg.body}`);
  
  if (msg.body.toLowerCase() === 'hola') {
    await msg.reply('¡Hola! 🎉 Bot funcionando correctamente');
    console.log('✅ Respuesta enviada');
  }
});

client.on('disconnected', (reason) => {
  console.log('❌ Desconectado:', reason);
  process.exit(1);
});

client.on('auth_failure', (msg) => {
  console.error('❌ Fallo de autenticación:', msg);
  process.exit(1);
});

// Evitar que el proceso termine
process.on('SIGINT', async () => {
  console.log('\n⏹️  Deteniendo bot...');
  await client.destroy();
  process.exit(0);
});

console.log('🚀 Iniciando bot de WhatsApp...');
console.log('⏳ Por favor espera, esto puede tardar 30-60 segundos...\n');

client.initialize();