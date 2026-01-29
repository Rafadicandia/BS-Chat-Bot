// ============= SCRIPT 1: IMPORTAR PROPIEDADES DESDE CSV/EXCEL =============
// importar-propiedades.js

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');

const db = new sqlite3.Database('./inmobiliaria.db');

// OPCIÓN A: Importar desde CSV
async function importarDesdeCSV(rutaArchivo) {
  console.log('📥 Importando propiedades desde CSV...');
  
  const propiedades = [];
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(rutaArchivo)
      .pipe(csv())
      .on('data', (row) => {
        propiedades.push({
          referencia: row.referencia || generarReferencia(),
          tipo: row.tipo, // piso, casa, local, apartamento, etc.
          operacion: row.operacion, // venta, alquiler
          precio: parseFloat(row.precio),
          habitaciones: parseInt(row.habitaciones),
          banos: parseInt(row.banos),
          metros: parseFloat(row.metros),
          direccion: row.direccion,
          ciudad: row.ciudad,
          codigo_postal: row.codigo_postal,
          descripcion: row.descripcion,
          caracteristicas: JSON.stringify(row.caracteristicas?.split(';') || []),
          estado: row.estado || 'disponible',
          fotos: row.fotos || '',
          fecha_alta: row.fecha_alta || new Date().toISOString(),
          agente: row.agente || 'Sin asignar'
        });
      })
      .on('end', async () => {
        for (const prop of propiedades) {
          await insertarPropiedad(prop);
        }
        console.log(`✅ Importadas ${propiedades.length} propiedades`);
        resolve();
      })
      .on('error', reject);
  });
}

// OPCIÓN B: Importar desde Excel
async function importarDesdeExcel(rutaArchivo) {
  console.log('📥 Importando propiedades desde Excel...');
  
  const workbook = XLSX.readFile(rutaArchivo);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const datos = XLSX.utils.sheet_to_json(sheet);
  
  for (const row of datos) {
    const prop = {
      referencia: row.Referencia || generarReferencia(),
      tipo: row.Tipo?.toLowerCase(),
      operacion: row.Operacion?.toLowerCase(),
      precio: parseFloat(row.Precio),
      habitaciones: parseInt(row.Habitaciones),
      banos: parseInt(row.Baños || row.Banos),
      metros: parseFloat(row.Metros),
      direccion: row.Direccion,
      ciudad: row.Ciudad,
      codigo_postal: row.CodigoPostal || row.CP,
      descripcion: row.Descripcion,
      caracteristicas: JSON.stringify(
        row.Caracteristicas?.split(';').map(c => c.trim()) || []
      ),
      estado: row.Estado?.toLowerCase() || 'disponible',
      fotos: row.Fotos || '',
      fecha_alta: row.FechaAlta || new Date().toISOString(),
      agente: row.Agente || 'Sin asignar'
    };
    
    await insertarPropiedad(prop);
  }
  
  console.log(`✅ Importadas ${datos.length} propiedades desde Excel`);
}

// OPCIÓN C: Importar desde JSON
async function importarDesdeJSON(rutaArchivo) {
  console.log('📥 Importando propiedades desde JSON...');
  
  const datos = JSON.parse(fs.readFileSync(rutaArchivo, 'utf8'));
  
  for (const prop of datos) {
    await insertarPropiedad({
      referencia: prop.referencia || generarReferencia(),
      tipo: prop.tipo,
      operacion: prop.operacion,
      precio: prop.precio,
      habitaciones: prop.habitaciones,
      banos: prop.banos,
      metros: prop.metros,
      direccion: prop.direccion,
      ciudad: prop.ciudad,
      codigo_postal: prop.codigo_postal,
      descripcion: prop.descripcion,
      caracteristicas: JSON.stringify(prop.caracteristicas || []),
      estado: prop.estado || 'disponible',
      fotos: JSON.stringify(prop.fotos || []),
      fecha_alta: prop.fecha_alta || new Date().toISOString(),
      agente: prop.agente || 'Sin asignar'
    });
  }
  
  console.log(`✅ Importadas ${datos.length} propiedades desde JSON`);
}

// Insertar propiedad en la base de datos
function insertarPropiedad(prop) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO propiedades 
       (referencia, tipo, operacion, precio, habitaciones, banos, metros, 
        direccion, ciudad, codigo_postal, descripcion, caracteristicas, 
        estado, fotos, fecha_alta, agente)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prop.referencia, prop.tipo, prop.operacion, prop.precio,
        prop.habitaciones, prop.banos, prop.metros, prop.direccion,
        prop.ciudad, prop.codigo_postal, prop.descripcion,
        prop.caracteristicas, prop.estado, prop.fotos,
        prop.fecha_alta, prop.agente
      ],
      (err) => {
        if (err) {
          console.error(`❌ Error insertando ${prop.referencia}:`, err);
          reject(err);
        } else {
          console.log(`✅ Propiedad ${prop.referencia} insertada`);
          resolve();
        }
      }
    );
  });
}

// Generar referencia única
function generarReferencia() {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `REF-${fecha}-${random}`;
}

// ============= SCRIPT 2: IMPORTAR MANUAL DE GESTIÓN =============
// importar-manual.js

const { Ollama } = require('ollama');
const { ChromaClient } = require('chromadb');
const pdf = require('pdf-parse');

const ollama = new Ollama({ host: 'http://localhost:11434' });
const chromaClient = new ChromaClient();

async function importarManualPDF(rutaPDF) {
  console.log('📚 Importando manual desde PDF...');
  
  const dataBuffer = fs.readFileSync(rutaPDF);
  const data = await pdf(dataBuffer);
  const texto = data.text;
  
  await procesarYAlmacenarDocumento(texto, 'Manual de Gestión');
}

async function importarManualTexto(rutaTXT) {
  console.log('📚 Importando manual desde TXT...');
  
  const texto = fs.readFileSync(rutaTXT, 'utf8');
  await procesarYAlmacenarDocumento(texto, path.basename(rutaTXT));
}

async function procesarYAlmacenarDocumento(texto, nombreDocumento) {
  // Dividir en secciones lógicas (por párrafos o títulos)
  const secciones = dividirEnSecciones(texto);
  
  const collection = await chromaClient.getOrCreateCollection({
    name: 'documentos_internos'
  });
  
  console.log(`📝 Procesando ${secciones.length} secciones...`);
  
  for (let i = 0; i < secciones.length; i++) {
    const seccion = secciones[i];
    
    // Generar embedding
    const embedding = await generarEmbedding(seccion);
    
    await collection.add({
      ids: [`${nombreDocumento}_${i}`],
      embeddings: [embedding],
      documents: [seccion],
      metadatas: [{
        fuente: nombreDocumento,
        seccion: i,
        fecha_importacion: new Date().toISOString()
      }]
    });
    
    if (i % 10 === 0) {
      console.log(`Procesadas ${i}/${secciones.length} secciones...`);
    }
  }
  
  console.log(`✅ Manual "${nombreDocumento}" importado correctamente`);
}

function dividirEnSecciones(texto) {
  // Dividir por párrafos vacíos o títulos en mayúsculas
  const secciones = [];
  const bloques = texto.split(/\n\n+/);
  
  for (let i = 0; i < bloques.length; i++) {
    const bloque = bloques[i].trim();
    
    if (bloque.length < 50) continue; // Saltar bloques muy cortos
    
    // Si el bloque es muy largo, dividir en chunks de ~500 palabras
    if (bloque.split(/\s+/).length > 500) {
      const palabras = bloque.split(/\s+/);
      for (let j = 0; j < palabras.length; j += 500) {
        secciones.push(palabras.slice(j, j + 500).join(' '));
      }
    } else {
      secciones.push(bloque);
    }
  }
  
  return secciones;
}

async function generarEmbedding(texto) {
  const response = await ollama.embeddings({
    model: 'nomic-embed-text',
    prompt: texto
  });
  return response.embedding;
}

// ============= SCRIPT 3: EJEMPLO DE USO =============
// usar-importacion.js

async function ejecutarImportacion() {
  try {
    // Importar propiedades
    console.log('\n🏠 === IMPORTANDO PROPIEDADES ===\n');
    
    // Elige el formato que tengas:
    await importarDesdeExcel('./propiedades.xlsx');
    // O: await importarDesdeCSV('./propiedades.csv');
    // O: await importarDesdeJSON('./propiedades.json');
    
    // Importar manual de gestión
    console.log('\n📚 === IMPORTANDO MANUAL DE GESTIÓN ===\n');
    
    await importarManualPDF('./manual-gestion.pdf');
    // O: await importarManualTexto('./manual-gestion.txt');
    
    console.log('\n✅ === IMPORTACIÓN COMPLETADA ===\n');
    
    db.close();
  } catch (error) {
    console.error('❌ Error en importación:', error);
  }
}

// Ejecutar
if (require.main === module) {
  ejecutarImportacion();
}

// ============= PLANTILLAS DE EJEMPLO =============

// EJEMPLO CSV (propiedades.csv):
/*
referencia,tipo,operacion,precio,habitaciones,banos,metros,direccion,ciudad,codigo_postal,descripcion,caracteristicas
REF-001,piso,venta,250000,3,2,95,Calle Mayor 45,Barcelona,08001,Precioso piso reformado en el centro,Ascensor;Terraza;Parking
REF-002,casa,venta,450000,4,3,180,Av. Diagonal 123,Barcelona,08028,Casa adosada con jardín,Jardín;Garaje;Piscina comunitaria
*/

// EJEMPLO JSON (propiedades.json):
/*
[
  {
    "referencia": "REF-001",
    "tipo": "piso",
    "operacion": "venta",
    "precio": 250000,
    "habitaciones": 3,
    "banos": 2,
    "metros": 95,
    "direccion": "Calle Mayor 45",
    "ciudad": "Barcelona",
    "codigo_postal": "08001",
    "descripcion": "Precioso piso reformado en el centro",
    "caracteristicas": ["Ascensor", "Terraza", "Parking"],
    "estado": "disponible",
    "fotos": ["foto1.jpg", "foto2.jpg"],
    "agente": "María García"
  }
]
*/

module.exports = {
  importarDesdeCSV,
  importarDesdeExcel,
  importarDesdeJSON,
  importarManualPDF,
  importarManualTexto
};