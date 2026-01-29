// Bot WhatsApp para Inmobiliaria con RAG + Base de Datos
// npm install whatsapp-web.js qrcode-terminal googleapis ollama chromadb sqlite3

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { google } = require('googleapis');
const { Ollama } = require('ollama');
const { ChromaClient } = require('chromadb');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// ============= CONFIGURACIÓN =============
const HORARIO_OFICINA = {
  inicio: 9,
  fin: 20,
  diasLaborables: [1, 2, 3, 4, 5, 6] // Lun-Sab
};

const ollama = new Ollama({ host: 'http://localhost:11434' });
const chromaClient = new ChromaClient();

// ============= BASE DE DATOS DE PROPIEDADES =============
const db = new sqlite3.Database('./inmobiliaria.db');

// Crear tablas si no existen
db.serialize(() => {
  // Tabla de propiedades
  db.run(`
    CREATE TABLE IF NOT EXISTS propiedades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referencia TEXT UNIQUE,
      tipo TEXT,
      operacion TEXT,
      precio REAL,
      habitaciones INTEGER,
      banos INTEGER,
      metros REAL,
      direccion TEXT,
      ciudad TEXT,
      codigo_postal TEXT,
      descripcion TEXT,
      caracteristicas TEXT,
      estado TEXT,
      fotos TEXT,
      fecha_alta DATE,
      agente TEXT
    )
  `);

  // Tabla de visitas programadas
  db.run(`
    CREATE TABLE IF NOT EXISTS visitas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      propiedad_id INTEGER,
      cliente_nombre TEXT,
      cliente_telefono TEXT,
      fecha_visita DATETIME,
      estado TEXT,
      notas TEXT,
      FOREIGN KEY (propiedad_id) REFERENCES propiedades (id)
    )
  `);
});

// ============= FUNCIONES DE BASE DE DATOS =============

// Buscar propiedades con filtros
function buscarPropiedades(filtros) {
  return new Promise((resolve, reject) => {
    let query = 'SELECT * FROM propiedades WHERE estado = "disponible"';
    const params = [];

    if (filtros.tipo) {
      query += ' AND tipo = ?';
      params.push(filtros.tipo);
    }
    if (filtros.operacion) {
      query += ' AND operacion = ?';
      params.push(filtros.operacion);
    }
    if (filtros.precioMin) {
      query += ' AND precio >= ?';
      params.push(filtros.precioMin);
    }
    if (filtros.precioMax) {
      query += ' AND precio <= ?';
      params.push(filtros.precioMax);
    }
    if (filtros.habitaciones) {
      query += ' AND habitaciones >= ?';
      params.push(filtros.habitaciones);
    }
    if (filtros.ciudad) {
      query += ' AND ciudad LIKE ?';
      params.push(`%${filtros.ciudad}%`);
    }

    query += ' LIMIT 10';

    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Obtener propiedad por referencia
function obtenerPropiedad(referencia) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM propiedades WHERE referencia = ?',
      [referencia],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

// Agendar visita
function agendarVisita(propiedadId, nombre, telefono, fecha, notas) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO visitas (propiedad_id, cliente_nombre, cliente_telefono, fecha_visita, estado, notas)
       VALUES (?, ?, ?, ?, 'pendiente', ?)`,
      [propiedadId, nombre, telefono, fecha, notas],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

// ============= SISTEMA RAG PARA DOCUMENTOS =============

let collectionDocumentos = null;
let collectionPropiedades = null;

// Inicializar ChromaDB
async function inicializarRAG() {
  try {
    // Colección para manual de gestión interna
    collectionDocumentos = await chromaClient.getOrCreateCollection({
      name: 'documentos_internos',
      metadata: { description: 'Manual de gestión y documentos internos' }
    });

    // Colección para propiedades (búsqueda semántica)
    collectionPropiedades = await chromaClient.getOrCreateCollection({
      name: 'propiedades',
      metadata: { description: 'Base de datos de propiedades vectorizada' }
    });

    console.log('✅ Sistema RAG inicializado');
  } catch (error) {
    console.error('Error inicializando RAG:', error);
  }
}

// Cargar documentos del manual de gestión
async function cargarManualGestion(rutaArchivo) {
  try {
    const contenido = fs.readFileSync(rutaArchivo, 'utf8');
    
    // Dividir en chunks de ~500 palabras
    const chunks = dividirTextoEnChunks(contenido, 500);
    
    // Generar embeddings con Ollama
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generarEmbedding(chunks[i]);
      
      await collectionDocumentos.add({
        ids: [`doc_${i}`],
        embeddings: [embedding],
        documents: [chunks[i]],
        metadatas: [{
          fuente: path.basename(rutaArchivo),
          chunk: i
        }]
      });
    }
    
    console.log(`✅ Cargados ${chunks.length} chunks del manual`);
  } catch (error) {
    console.error('Error cargando manual:', error);
  }
}

// Indexar propiedades para búsqueda semántica
async function indexarPropiedades() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM propiedades WHERE estado = "disponible"', async (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      for (const prop of rows) {
        const descripcionCompleta = `
          ${prop.tipo} en ${prop.operacion} en ${prop.ciudad}.
          ${prop.habitaciones} habitaciones, ${prop.banos} baños, ${prop.metros}m².
          Precio: ${prop.precio}€.
          ${prop.descripcion}.
          Características: ${prop.caracteristicas}
        `;

        const embedding = await generarEmbedding(descripcionCompleta);
        
        await collectionPropiedades.add({
          ids: [prop.referencia],
          embeddings: [embedding],
          documents: [descripcionCompleta],
          metadatas: [{
            referencia: prop.referencia,
            tipo: prop.tipo,
            ciudad: prop.ciudad,
            precio: prop.precio
          }]
        });
      }

      console.log(`✅ Indexadas ${rows.length} propiedades`);
      resolve();
    });
  });
}

// Generar embedding con Ollama
async function generarEmbedding(texto) {
  const response = await ollama.embeddings({
    model: 'nomic-embed-text',
    prompt: texto
  });
  return response.embedding;
}

// Dividir texto en chunks
function dividirTextoEnChunks(texto, palabrasPorChunk) {
  const palabras = texto.split(/\s+/);
  const chunks = [];
  
  for (let i = 0; i < palabras.length; i += palabrasPorChunk) {
    chunks.push(palabras.slice(i, i + palabrasPorChunk).join(' '));
  }
  
  return chunks;
}

// Buscar información relevante en documentos
async function buscarEnDocumentos(pregunta) {
  try {
    const embedding = await generarEmbedding(pregunta);
    
    const resultados = await collectionDocumentos.query({
      queryEmbeddings: [embedding],
      nResults: 3
    });

    return resultados.documents[0] || [];
  } catch (error) {
    console.error('Error buscando en documentos:', error);
    return [];
  }
}

// Buscar propiedades similares (búsqueda semántica)
async function buscarPropiedadesSemanticamente(consulta) {
  try {
    const embedding = await generarEmbedding(consulta);
    
    const resultados = await collectionPropiedades.query({
      queryEmbeddings: [embedding],
      nResults: 5
    });

    // Obtener detalles completos de las propiedades
    const referencias = resultados.metadatas[0].map(m => m.referencia);
    const propiedades = [];
    
    for (const ref of referencias) {
      const prop = await obtenerPropiedad(ref);
      if (prop) propiedades.push(prop);
    }

    return propiedades;
  } catch (error) {
    console.error('Error en búsqueda semántica:', error);
    return [];
  }
}

// ============= RESPONDER CON IA + RAG =============
async function responderConIA(pregunta, contexto = {}) {
  try {
    let contextoAdicional = '';

    // Buscar en documentos internos si es pregunta sobre gestión
    if (pregunta.includes('procedimiento') || pregunta.includes('cómo') || 
        pregunta.includes('política') || pregunta.includes('manual')) {
      const docsRelevantes = await buscarEnDocumentos(pregunta);
      if (docsRelevantes.length > 0) {
        contextoAdicional += '\n\nINFORMACIÓN DEL MANUAL:\n' + docsRelevantes.join('\n\n');
      }
    }

    // Si hay propiedades en el contexto, incluirlas
    if (contexto.propiedades && contexto.propiedades.length > 0) {
      contextoAdicional += '\n\nPROPIEDADES DISPONIBLES:\n';
      contexto.propiedades.forEach((p, i) => {
        contextoAdicional += `\n${i + 1}. REF: ${p.referencia}
        ${p.tipo} en ${p.operacion} - ${p.ciudad}
        ${p.habitaciones} hab, ${p.banos} baños, ${p.metros}m²
        Precio: ${p.precio.toLocaleString()}€
        ${p.descripcion}\n`;
      });
    }

    const systemPrompt = `Eres un asistente virtual profesional de una inmobiliaria.

INSTRUCCIONES:
- Sé amable, profesional y conciso
- Proporciona información precisa sobre propiedades
- Si tienes información del manual, úsala
- Para agendar visitas, pide: nombre, fecha y hora preferida
- Siempre menciona la referencia de las propiedades
- Si no tienes información, ofrece conectar con un agente
- Usa emojis moderadamente 🏠

CONTEXTO ADICIONAL:${contextoAdicional}`;

    const response = await ollama.chat({
      model: 'llama3.2',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: pregunta }
      ],
      stream: false,
    });

    return response.message.content;
  } catch (error) {
    console.error('Error con IA:', error);
    return 'Disculpa, tuve un problema. ¿Podrías reformular tu pregunta o escribir "menu"?';
  }
}

// ============= GOOGLE CALENDAR =============
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

async function getGoogleAuth() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (fs.existsSync(TOKEN_PATH)) {
    const token = fs.readFileSync(TOKEN_PATH);
    oAuth2Client.setCredentials(JSON.parse(token));
    return oAuth2Client;
  }
  
  throw new Error('Autoriza Google Calendar primero');
}

async function agendarVisitaCalendar(auth, propiedad, cliente, fecha) {
  const calendar = google.calendar({ version: 'v3', auth });
  
  const event = {
    summary: `Visita: ${propiedad.referencia} - ${cliente.nombre}`,
    description: `
Cliente: ${cliente.nombre}
Teléfono: ${cliente.telefono}
Propiedad: ${propiedad.referencia}
Dirección: ${propiedad.direccion}, ${propiedad.ciudad}
Tipo: ${propiedad.tipo}
Precio: ${propiedad.precio}€
    `,
    location: `${propiedad.direccion}, ${propiedad.ciudad}`,
    start: {
      dateTime: fecha.toISOString(),
      timeZone: 'Europe/Madrid',
    },
    end: {
      dateTime: new Date(fecha.getTime() + 60 * 60000).toISOString(),
      timeZone: 'Europe/Madrid',
    },
  };

  const res = await calendar.events.insert({
    calendarId: 'primary',
    resource: event,
  });
  
  return res.data;
}

// ============= WHATSAPP BOT =============
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox'] }
});

const conversaciones = new Map();

client.on('qr', (qr) => {
  console.log('Escanea este código QR:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('🏠 Bot Inmobiliaria iniciado!');
  await inicializarRAG();
  await indexarPropiedades();
});

client.on('message', async (msg) => {
  const contacto = await msg.getContact();
  const numero = contacto.number;
  const mensaje = msg.body.toLowerCase().trim();

  let estado = conversaciones.get(numero) || { paso: 'inicio' };

  try {
    // MENÚ PRINCIPAL
    if (mensaje === 'menu' || mensaje === 'hola' || estado.paso === 'inicio') {
      await msg.reply(
        `¡Hola ${contacto.pushname}! 👋 Bienvenido a nuestra inmobiliaria\n\n` +
        '🏠 *OPCIONES:*\n\n' +
        '1️⃣ Buscar propiedades\n' +
        '2️⃣ Agendar visita\n' +
        '3️⃣ Información de propiedad\n' +
        '4️⃣ Mis visitas programadas\n\n' +
        '💬 O pregúntame directamente:\n' +
        '• "Pisos en Barcelona de 3 habitaciones"\n' +
        '• "Casas en venta hasta 300.000€"\n' +
        '• "¿Cuál es el procedimiento de reserva?"'
      );
      estado.paso = 'menu';
      conversaciones.set(numero, estado);
      return;
    }

    // BÚSQUEDA DE PROPIEDADES
    if (mensaje === '1' || estado.paso === 'buscar_propiedades') {
      if (estado.paso !== 'buscar_propiedades') {
        await msg.reply(
          '🔍 *BÚSQUEDA DE PROPIEDADES*\n\n' +
          '¿Qué estás buscando?\n\n' +
          'Ejemplos:\n' +
          '• "Piso en Barcelona de 2 habitaciones"\n' +
          '• "Casa en venta hasta 250.000€"\n' +
          '• "Local comercial en alquiler"\n\n' +
          'O escribe "filtros" para búsqueda avanzada'
        );
        estado.paso = 'buscar_propiedades';
        conversaciones.set(numero, estado);
        return;
      }

      // Búsqueda semántica con IA
      const propiedades = await buscarPropiedadesSemanticamente(msg.body);
      
      if (propiedades.length === 0) {
        await msg.reply('😔 No encontré propiedades que coincidan. Intenta con otros criterios.');
        return;
      }

      let respuesta = `✅ Encontré ${propiedades.length} propiedades:\n\n`;
      propiedades.forEach((p, i) => {
        respuesta += `${i + 1}️⃣ *REF: ${p.referencia}*\n`;
        respuesta += `${p.tipo} en ${p.operacion} - ${p.ciudad}\n`;
        respuesta += `💰 ${p.precio.toLocaleString()}€ | 🛏️ ${p.habitaciones} hab | 🚿 ${p.banos} baños | 📏 ${p.metros}m²\n`;
        respuesta += `📍 ${p.direccion}\n\n`;
      });
      
      respuesta += '💬 Escribe el número o la referencia para más detalles\n';
      respuesta += 'O escribe "visita REF-XXX" para agendar';

      estado.propiedadesEncontradas = propiedades;
      conversaciones.set(numero, estado);
      
      await msg.reply(respuesta);
      return;
    }

    // DETALLE DE PROPIEDAD
    if (mensaje.startsWith('ref-') || /^\d+$/.test(mensaje)) {
      let propiedad;
      
      if (mensaje.startsWith('ref-')) {
        propiedad = await obtenerPropiedad(mensaje.toUpperCase());
      } else if (estado.propiedadesEncontradas) {
        const indice = parseInt(mensaje) - 1;
        propiedad = estado.propiedadesEncontradas[indice];
      }

      if (!propiedad) {
        await msg.reply('❌ Propiedad no encontrada. Verifica la referencia.');
        return;
      }

      const caracteristicas = JSON.parse(propiedad.caracteristicas || '[]');
      
      let respuesta = `🏠 *${propiedad.tipo.toUpperCase()} - ${propiedad.referencia}*\n\n`;
      respuesta += `💰 *Precio:* ${propiedad.precio.toLocaleString()}€\n`;
      respuesta += `📍 *Ubicación:* ${propiedad.direccion}, ${propiedad.ciudad}\n`;
      respuesta += `📐 *Superficie:* ${propiedad.metros}m²\n`;
      respuesta += `🛏️ *Habitaciones:* ${propiedad.habitaciones}\n`;
      respuesta += `🚿 *Baños:* ${propiedad.banos}\n\n`;
      respuesta += `📝 *Descripción:*\n${propiedad.descripcion}\n\n`;
      
      if (caracteristicas.length > 0) {
        respuesta += `✨ *Características:*\n`;
        caracteristicas.forEach(c => respuesta += `• ${c}\n`);
        respuesta += '\n';
      }
      
      respuesta += `📞 Para agendar visita escribe: "visita ${propiedad.referencia}"`;

      await msg.reply(respuesta);
      return;
    }

    // AGENDAR VISITA
    if (mensaje.startsWith('visita ') || estado.paso === 'agendar_visita') {
      if (!estado.paso.includes('agendar')) {
        const ref = mensaje.replace('visita ', '').toUpperCase();
        const propiedad = await obtenerPropiedad(ref);
        
        if (!propiedad) {
          await msg.reply('❌ Propiedad no encontrada.');
          return;
        }

        estado.propiedadVisita = propiedad;
        estado.paso = 'agendar_visita_nombre';
        conversaciones.set(numero, estado);
        
        await msg.reply(`Perfecto! 📅 ¿Cuál es tu nombre completo?`);
        return;
      }

      if (estado.paso === 'agendar_visita_nombre') {
        estado.nombreCliente = msg.body;
        estado.paso = 'agendar_visita_fecha';
        conversaciones.set(numero, estado);
        
        await msg.reply(
          `Gracias ${estado.nombreCliente}! 📅\n\n` +
          'Indícame la fecha y hora preferida:\n' +
          'Formato: DD/MM/AAAA HH:MM\n' +
          'Ejemplo: 20/02/2026 10:00'
        );
        return;
      }

      if (estado.paso === 'agendar_visita_fecha') {
        const partes = msg.body.split(' ');
        const fechaPartes = partes[0].split('/');
        const horaPartes = partes[1].split(':');
        
        const fecha = new Date(
          fechaPartes[2],
          fechaPartes[1] - 1,
          fechaPartes[0],
          horaPartes[0],
          horaPartes[1]
        );

        if (fecha < new Date()) {
          await msg.reply('❌ La fecha no puede ser en el pasado.');
          return;
        }

        // Guardar en base de datos
        await agendarVisita(
          estado.propiedadVisita.id,
          estado.nombreCliente,
          numero,
          fecha.toISOString(),
          ''
        );

        // Agregar a Google Calendar
        const auth = await getGoogleAuth();
        await agendarVisitaCalendar(auth, estado.propiedadVisita, {
          nombre: estado.nombreCliente,
          telefono: numero
        }, fecha);

        await msg.reply(
          `✅ *¡VISITA AGENDADA!*\n\n` +
          `🏠 Propiedad: ${estado.propiedadVisita.referencia}\n` +
          `👤 Cliente: ${estado.nombreCliente}\n` +
          `📅 Fecha: ${fecha.toLocaleDateString('es-ES')}\n` +
          `🕐 Hora: ${fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n` +
          `📍 ${estado.propiedadVisita.direccion}, ${estado.propiedadVisita.ciudad}\n\n` +
          `Te enviaremos un recordatorio. ¡Hasta pronto! 🎉`
        );

        conversaciones.delete(numero);
        return;
      }
    }

    // PREGUNTAS CON IA + RAG
    if (estado.paso === 'menu') {
      // Intentar extraer intención de búsqueda
      const esConsultaPropiedad = mensaje.includes('piso') || mensaje.includes('casa') || 
                                   mensaje.includes('local') || mensaje.includes('apartamento') ||
                                   mensaje.includes('habitacion') || mensaje.includes('venta') ||
                                   mensaje.includes('alquiler');

      let contexto = {};
      
      if (esConsultaPropiedad) {
        const propiedades = await buscarPropiedadesSemanticamente(msg.body);
        contexto.propiedades = propiedades;
      }

      const respuestaIA = await responderConIA(msg.body, contexto);
      await msg.reply(respuestaIA);
      return;
    }

  } catch (error) {
    console.error('Error:', error);
    await msg.reply('❌ Hubo un error. Escribe "menu" para reintentar.');
    conversaciones.delete(numero);
  }
});

// ============= INICIAR BOT =============
client.initialize();