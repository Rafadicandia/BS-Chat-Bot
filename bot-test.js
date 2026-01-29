
cat > bot-test.js << 'EOF'
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { 
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: false  // Ver el navegador
  }
});

client.on('qr', (qr) => {
  console.log('\n📱 ESCANEA EL QR:\n');
  qrcode.generate(qr, { small: true });
});

client.on('loading_screen', (percent, message) => {
  console.log('Cargando WhatsApp...', percent, message);
});

client.on('authenticated', () => {
  console.log('✅ Autenticado');
});

client.on('ready', () => {
  console.log('✅✅✅ BOT LISTO Y FUNCIONANDO ✅✅✅');
  console.log('Envíate un mensaje de prueba');
});

client.on('message', async (msg) => {
  console.log('📨 Mensaje recibido:', msg.body);
  if (msg.body === 'hola') {
    await msg.reply('¡Hola! Bot funcionando correctamente 🎉');
  }
});

client.on('disconnected', (reason) => {
  console.log('❌ Desconectado:', reason);
});

console.log('🚀 Iniciando bot de prueba...\n');
client.initialize();
EOF
