// bot-inmobiliaria.js
// Bot simplificado SIN Google Calendar (lo agregaremos después)

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { Ollama } = require('ollama');
const sqlite3 = require('sqlite3').verbose();

// ============= CONFIGURACIÓN =============
const HORARIO_OFICINA = {
  inicio: 9,
  fin: 20,
  diasLaborables: [1, 2, 3, 4, 5, 6] // Lun-Sab
};

const ollama = new Ollama({ host: 'http://localhost:11434' });
const db = new sqlite3.Database('./inmobiliaria.db');

// ============= INFO DEL NEGOCIO =============
const INFO_NEGOCIO = `
INFORMACIÓN DE LA INMOBILIARIA:

Horario de atención:
- Lunes a Sábado: 9:00 - 20:00
- Domingos: Cerrado

Servicios:
- Venta de propiedades
- Alquiler de propiedades
- Asesoramiento inmobiliario
- Visitas a propiedades

Formas de pago:
- Efectivo
- Transferencia bancaria
- Cheque

Políticas:
- Primera visita sin costo
- Asesoramiento personalizado
- Gestión completa de documentación
`;

// ============= FUNCIONES DE BASE DE DATOS =============

function buscarPropiedades(filtros) {
  return new Promise((resolve, reject) => {
    let query = 'SELECT * FROM propiedades WHERE estado = "disponible"';
    const params = [];

    if (filtros.operacion) {
      query += ' AND operacion LIKE ?';
      params.push(`%${filtros.operacion}%`);
    }
    if (filtros.ciudad) {
      query += ' AND ciudad LIKE ?';
      params.push(`%${filtros.ciudad}%`);
    }
    if (filtros.precioMax) {
      query += ' AND precio <= ?';
      params.push(filtros.precioMax);
    }
    if (filtros.habitaciones) {
      query += ' AND habitaciones >= ?';
      params.push(filtros.habitaciones);
    }

    query += ' ORDER BY precio DESC LIMIT 10';

    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function obtenerPropiedad(referencia) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM propiedades WHERE referencia = ? OR padron = ?',
      [referencia, referencia],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

function buscarPorTexto(texto) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT * FROM propiedades 
      WHERE estado = "disponible"
      AND (
        descripcion LIKE ? OR
        direccion LIKE ? OR
        ciudad LIKE ? OR
        zona LIKE ? OR
        tipo LIKE ?
      )
      LIMIT 10
    `;
    
    const searchTerm = `%${texto}%`;
    const params = [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm];

    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function guardarVisita(propiedadRef, nombre, telefono, fecha, notas) {
  return new Promise((resolve, reject) => {
    // Primero obtener el ID de la propiedad
    db.get(
      'SELECT id FROM propiedades WHERE referencia = ? OR padron = ?',
      [propiedadRef, propiedadRef],
      (err, row) => {
        if (err || !row) {
          reject(err || new Error('Propiedad no encontrada'));
          return;
        }

        db.run(
          `INSERT INTO visitas (propiedad_id, cliente_nombre, cliente_telefono, fecha_visita, estado, notas)
           VALUES (?, ?, ?, ?, 'pendiente', ?)`,
          [row.id, nombre, telefono, fecha, notas],
          function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
          }
        );
      }
    );
  });
}

// ============= RESPONDER CON IA =============
async function responderConIA(pregunta, contexto = {}) {
  try {
    let contextoAdicional = '';

    if (contexto.propiedades && contexto.propiedades.length > 0) {
      contextoAdicional += '\n\nPROPIEDADES DISPONIBLES:\n';
      contexto.propiedades.forEach((p, i) => {
        const caract = JSON.parse(p.caracteristicas || '[]');
        contextoAdicional += `\n${i + 1}. REF: ${p.referencia || p.padron}
        ${p.tipo || 'Propiedad'} en ${p.operacion} - ${p.ciudad || 'Sin especificar'}
        ${p.habitaciones || 0} hab, ${p.banos || 0} baños, ${p.metros || 0}m²
        Precio: ${p.precio ? p.precio.toLocaleString() + '€' : 'Consultar'}
        ${p.direccion || ''}
        ${caract.length > 0 ? 'Características: ' + caract.join(', ') : ''}
        ${p.descripcion || ''}\n`;
      });
    }

    const systemPrompt = `Eres un asistente virtual profesional de una inmobiliaria.

${INFO_NEGOCIO}

INSTRUCCIONES:
- Sé amable, profesional y conciso
- Proporciona información precisa sobre propiedades
- Para agendar visitas, pide: nombre, fecha y hora preferida
- Siempre menciona la referencia de las propiedades
- Si no tienes información, ofrece conectar con un agente
- Usa emojis moderadamente 🏠
- Respuestas cortas (máximo 4-5 líneas)

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

// ============= WHATSAPP BOT =============
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { 
    args: ['--no-sandbox'],
    headless: true
  }
});

const conversaciones = new Map();

client.on('qr', (qr) => {
  console.log('\n📱 ESCANEA ESTE CÓDIGO QR CON WHATSAPP:\n');
  qrcode.generate(qr, { small: true });
  console.log('\n👆 Abre WhatsApp > Dispositivos vinculados > Vincular dispositivo\n');
});

client.on('ready', () => {
  console.log('\n✅ ¡BOT CONECTADO EXITOSAMENTE!\n');
  console.log('🏠 Bot inmobiliaria listo para recibir mensajes');
  console.log('📊 Base de datos: inmobiliaria.db');
  console.log('🤖 IA: Ollama (llama3.2)\n');
  
  // Verificar cuántas propiedades hay
  db.get('SELECT COUNT(*) as total FROM propiedades', (err, row) => {
    if (!err && row) {
      console.log(`📦 Propiedades en BD: ${row.total}\n`);
    }
  });
});

client.on('authenticated', () => {
  console.log('✅ WhatsApp autenticado correctamente');
});

client.on('auth_failure', () => {
  console.error('❌ Error de autenticación. Elimina la carpeta .wwebjs_auth e intenta de nuevo');
});

client.on('disconnected', (reason) => {
  console.log('⚠️  Bot desconectado:', reason);
});

client.on('message', async (msg) => {
  const contacto = await msg.getContact();
  const numero = contacto.number;
  const mensaje = msg.body.toLowerCase().trim();

  // Ignorar mensajes de grupos
  if (msg.from.includes('@g.us')) return;

  const ahora = new Date();
  const diaActual = ahora.getDay();
  const horaActual = ahora.getHours();
  
  const enHorario = HORARIO_OFICINA.diasLaborables.includes(diaActual) &&
                    horaActual >= HORARIO_OFICINA.inicio &&
                    horaActual < HORARIO_OFICINA.fin;

  let estado = conversaciones.get(numero) || { paso: 'inicio' };

  try {
    // ===== MENÚ PRINCIPAL =====
    if (mensaje === 'menu' || mensaje === 'hola' || mensaje === 'inicio' || estado.paso === 'inicio') {
      await msg.reply(
        `¡Hola ${contacto.pushname || 'amigo/a'}! 👋\n\n` +
        `Bienvenido a nuestra inmobiliaria\n\n` +
        (enHorario ? '✅ Estamos en horario de atención\n\n' : '⏰ Estamos fuera de horario, pero puedo ayudarte\n\n') +
        '🏠 *OPCIONES:*\n\n' +
        '1️⃣ Buscar propiedades\n' +
        '2️⃣ Información de propiedad\n' +
        '3️⃣ Agendar visita\n' +
        '4️⃣ Contacto\n\n' +
        '💬 O pregúntame directamente:\n' +
        '• "Casas en venta en Montevideo"\n' +
        '• "Apartamentos hasta 200.000"\n' +
        '• "Propiedades con piscina"'
      );
      estado.paso = 'menu';
      conversaciones.set(numero, estado);
      return;
    }

    // ===== BÚSQUEDA DE PROPIEDADES =====
    if (mensaje === '1' || estado.paso === 'buscar') {
      if (estado.paso !== 'buscar') {
        await msg.reply(
          '🔍 *BÚSQUEDA DE PROPIEDADES*\n\n' +
          '¿Qué estás buscando?\n\n' +
          'Ejemplos:\n' +
          '• "Casa en Montevideo"\n' +
          '• "Apartamento 2 dormitorios"\n' +
          '• "Propiedad hasta 150000"'
        );
        estado.paso = 'buscar';
        conversaciones.set(numero, estado);
        return;
      }

      // Realizar búsqueda
      const propiedades = await buscarPorTexto(msg.body);
      
      if (propiedades.length === 0) {
        await msg.reply('😔 No encontré propiedades con esos criterios.\n\nIntenta con otros términos o escribe "menu"');
        estado.paso = 'menu';
        conversaciones.set(numero, estado);
        return;
      }

      let respuesta = `✅ Encontré ${propiedades.length} propiedades:\n\n`;
      propiedades.forEach((p, i) => {
        const ref = p.referencia || p.padron || 'Sin ref';
        respuesta += `${i + 1}️⃣ *${ref}*\n`;
        respuesta += `${p.tipo || 'Propiedad'} en ${p.operacion || 'venta'}\n`;
        respuesta += `📍 ${p.ciudad || p.zona || 'Sin ubicación'}\n`;
        respuesta += `💰 ${p.precio ? p.precio.toLocaleString() + '€' : 'Consultar'} | `;
        respuesta += `🛏️ ${p.habitaciones || 0} hab | `;
        respuesta += `📏 ${p.metros || 0}m²\n\n`;
      });
      
      respuesta += '💬 Escribe el número o referencia para más detalles';

      estado.propiedadesEncontradas = propiedades;
      estado.paso = 'menu';
      conversaciones.set(numero, estado);
      
      await msg.reply(respuesta);
      return;
    }

    // ===== VER DETALLE DE PROPIEDAD =====
    if (mensaje === '2' || mensaje.match(/^[0-9]+$/) || mensaje.includes('ref')) {
      let propiedad;
      
      // Si es un número y hay propiedades encontradas
      if (mensaje.match(/^[0-9]+$/) && estado.propiedadesEncontradas) {
        const indice = parseInt(mensaje) - 1;
        propiedad = estado.propiedadesEncontradas[indice];
      } else if (mensaje !== '2') {
        // Si no, buscar por referencia
        propiedad = await obtenerPropiedad(mensaje.toUpperCase());
      } else {
        await msg.reply('Por favor indica la referencia de la propiedad\nEjemplo: 125355 o REF-001');
        return;
      }

      if (!propiedad) {
        await msg.reply('❌ Propiedad no encontrada.\n\nVerifica la referencia o escribe "1" para buscar.');
        return;
      }

      const caract = JSON.parse(propiedad.caracteristicas || '[]');
      const ref = propiedad.referencia || propiedad.padron;
      
      let respuesta = `🏠 *${propiedad.tipo?.toUpperCase() || 'PROPIEDAD'} - ${ref}*\n\n`;
      respuesta += `💰 *Precio:* ${propiedad.precio ? propiedad.precio.toLocaleString() + '€' : 'Consultar'}\n`;
      respuesta += `📍 *Ubicación:* ${propiedad.direccion || ''}, ${propiedad.ciudad || ''}\n`;
      if (propiedad.zona) respuesta += `🗺️  *Zona:* ${propiedad.zona}\n`;
      respuesta += `📐 *Superficie:* ${propiedad.metros || 0}m²\n`;
      respuesta += `🛏️ *Dormitorios:* ${propiedad.habitaciones || 0}\n`;
      respuesta += `🚿 *Baños:* ${propiedad.banos || 0}\n`;
      if (propiedad.garages > 0) respuesta += `🚗 *Garages:* ${propiedad.garages}\n`;
      
      if (propiedad.descripcion) {
        respuesta += `\n📝 *Descripción:*\n${propiedad.descripcion.substring(0, 200)}${propiedad.descripcion.length > 200 ? '...' : ''}\n`;
      }
      
      if (caract.length > 0) {
        respuesta += `\n✨ *Características:*\n`;
        caract.forEach(c => respuesta += `• ${c}\n`);
      }
      
      respuesta += `\n📞 Para agendar visita escribe: "3"`;

      estado.propiedadActual = propiedad;
      conversaciones.set(numero, estado);

      await msg.reply(respuesta);
      return;
    }

    // ===== AGENDAR VISITA =====
    if (mensaje === '3' || estado.paso.includes('visita')) {
      if (estado.paso !== 'visita_nombre' && estado.paso !== 'visita_fecha') {
        if (!estado.propiedadActual) {
          await msg.reply('Primero debes seleccionar una propiedad.\n\nEscribe "1" para buscar.');
          return;
        }

        estado.paso = 'visita_nombre';
        conversaciones.set(numero, estado);
        await msg.reply('📅 Perfecto! ¿Cuál es tu nombre completo?');
        return;
      }

      if (estado.paso === 'visita_nombre') {
        estado.nombreCliente = msg.body;
        estado.paso = 'visita_fecha';
        conversaciones.set(numero, estado);
        
        await msg.reply(
          `Gracias ${estado.nombreCliente}! 📅\n\n` +
          'Indícame fecha y hora para la visita:\n' +
          'Formato: DD/MM/AAAA HH:MM\n' +
          'Ejemplo: 05/02/2026 15:00'
        );
        return;
      }

      if (estado.paso === 'visita_fecha') {
        // Guardar visita
        try {
          const ref = estado.propiedadActual.referencia || estado.propiedadActual.padron;
          await guardarVisita(ref, estado.nombreCliente, numero, msg.body, '');

          await msg.reply(
            `✅ *¡VISITA AGENDADA!*\n\n` +
            `🏠 Propiedad: ${ref}\n` +
            `👤 Cliente: ${estado.nombreCliente}\n` +
            `📅 Fecha: ${msg.body}\n` +
            `📍 ${estado.propiedadActual.direccion}, ${estado.propiedadActual.ciudad}\n\n` +
            `Te contactaremos para confirmar. ¡Gracias! 🎉`
          );

          conversaciones.delete(numero);
        } catch (error) {
          console.error('Error guardando visita:', error);
          await msg.reply('❌ Hubo un error al agendar. Por favor llámanos directamente.');
        }
        return;
      }
    }

    // ===== CONTACTO =====
    if (mensaje === '4') {
      await msg.reply(
        '📞 *INFORMACIÓN DE CONTACTO*\n\n' +
        '⏰ Horario:\nLunes a Sábado: 9:00 - 20:00\n\n' +
        '📍 Dirección: [Tu dirección]\n' +
        '📧 Email: [Tu email]\n' +
        '📱 WhatsApp: Este número\n\n' +
        'Escribe "menu" para volver'
      );
      return;
    }

    // ===== CHAT CON IA =====
    if (estado.paso === 'menu' || estado.paso === 'buscar') {
      // Buscar propiedades relevantes
      const propiedades = await buscarPorTexto(msg.body);
      const contexto = { propiedades: propiedades.slice(0, 5) };

      const respuestaIA = await responderConIA(msg.body, contexto);
      await msg.reply(respuestaIA);
      return;
    }

  } catch (error) {
    console.error('Error:', error);
    await msg.reply('❌ Hubo un error. Escribe "menu" para reiniciar.');
    conversaciones.delete(numero);
  }
});

// ============= INICIAR BOT =============
console.log('🚀 Iniciando bot de WhatsApp...\n');
client.initialize();