// importar-propiedades-inmobiliaria.js
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const csv = require('csv-parser');

const db = new sqlite3.Database('./inmobiliaria.db');

// ============= PASO 1: CREAR TABLAS =============
function crearTablas() {
  return new Promise((resolve, reject) => {
    console.log('📋 Creando tablas en la base de datos...\n');
    
    db.serialize(() => {
      // Crear tabla de propiedades adaptada a tu sistema
      db.run(`
        CREATE TABLE IF NOT EXISTS propiedades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          id_propiedad_original TEXT,
          referencia TEXT UNIQUE,
          tipo TEXT,
          operacion TEXT,
          precio REAL,
          habitaciones INTEGER,
          banos INTEGER,
          metros REAL,
          direccion TEXT,
          ciudad TEXT,
          departamento TEXT,
          zona TEXT,
          codigo_postal TEXT,
          descripcion TEXT,
          caracteristicas TEXT,
          estado TEXT DEFAULT 'disponible',
          fotos TEXT,
          fecha_alta DATE,
          agente TEXT,
          superficie_construida REAL,
          superficie_terreno REAL,
          garages INTEGER,
          piscina INTEGER,
          parrillero INTEGER,
          calefaccion INTEGER,
          amueblado INTEGER,
          ascensor INTEGER,
          seguridad INTEGER,
          gastos_comunes REAL,
          web INTEGER,
          web_destacada INTEGER,
          padron TEXT
        )
      `, (err) => {
        if (err) {
          console.error('❌ Error creando tabla propiedades:', err);
          reject(err);
        } else {
          console.log('✅ Tabla propiedades creada');
        }
      });

      // Crear tabla de visitas
      db.run(`
        CREATE TABLE IF NOT EXISTS visitas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          propiedad_id INTEGER,
          cliente_nombre TEXT,
          cliente_telefono TEXT,
          fecha_visita DATETIME,
          estado TEXT DEFAULT 'pendiente',
          notas TEXT,
          FOREIGN KEY (propiedad_id) REFERENCES propiedades (id)
        )
      `, (err) => {
        if (err) {
          console.error('❌ Error creando tabla visitas:', err);
          reject(err);
        } else {
          console.log('✅ Tabla visitas creada');
          resolve();
        }
      });
    });
  });
}

// ============= PASO 2: IMPORTAR CSV CON PUNTO Y COMA =============
async function importarDesdeCSV(rutaArchivo) {
  console.log('\n📥 Importando propiedades desde CSV...\n');
  
  if (!fs.existsSync(rutaArchivo)) {
    console.error(`❌ Archivo no encontrado: ${rutaArchivo}`);
    return;
  }

  const propiedades = [];
  let errores = 0;
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(rutaArchivo)
      .pipe(csv({ separator: ';' })) // IMPORTANTE: punto y coma como separador
      .on('data', (row) => {
        // Mostrar columnas detectadas (solo primera vez)
        if (propiedades.length === 0) {
          console.log('📊 Columnas detectadas:', Object.keys(row).length);
          console.log('📊 Primeros campos:', Object.keys(row).slice(0, 10).join(', '));
          console.log('');
        }

        try {
          // Determinar operación (venta, alquiler o ambas)
          let operacion = '';
          const enVenta = row.en_venta === '1' || row.en_venta === 'true';
          const enAlquiler = row.en_alquiler === '1' || row.en_alquiler === 'true';
          
          if (enVenta && enAlquiler) {
            operacion = 'venta y alquiler';
          } else if (enVenta) {
            operacion = 'venta';
          } else if (enAlquiler) {
            operacion = 'alquiler';
          } else {
            operacion = 'sin especificar';
          }

          // Determinar precio (priorizar venta, luego alquiler)
          let precio = 0;
          if (enVenta && row.precio_venta) {
            precio = parseFloat(row.precio_venta) || 0;
          } else if (enAlquiler && row.precio_aqluiler) {
            precio = parseFloat(row.precio_aqluiler) || 0;
          }

          // Generar referencia única
          const referencia = row.padron || `REF-${row.id_propiedad}` || generarReferencia();

          // Construir características
          const caracteristicasArray = [];
          if (row.piscina === '1') caracteristicasArray.push('Piscina');
          if (row.parrillero === '1') caracteristicasArray.push('Parrillero');
          if (row.calefaccion === '1') caracteristicasArray.push('Calefacción');
          if (row.amueblado === '1') caracteristicasArray.push('Amueblado');
          if (row.ascensor === '1') caracteristicasArray.push('Ascensor');
          if (row.seguridad === '1') caracteristicasArray.push('Seguridad');
          if (row.garages && parseInt(row.garages) > 0) {
            caracteristicasArray.push(`${row.garages} Garage(s)`);
          }

          const prop = {
            id_propiedad_original: row.id_propiedad || '',
            referencia: referencia,
            tipo: row.id_propiedad_tipo || 'sin especificar',
            operacion: operacion,
            precio: precio,
            habitaciones: parseInt(row.dormitorios) || 0,
            banos: parseInt(row.banios) || 0,
            metros: parseFloat(row.superficie) || 0,
            direccion: row.direccion || '',
            ciudad: row.ciudad || '',
            departamento: row.departamento || '',
            zona: row.zona || '',
            codigo_postal: row.codigo_pais || '',
            descripcion: row.descripcion || row.web_descripcion || '',
            caracteristicas: JSON.stringify(caracteristicasArray),
            estado: (enVenta || enAlquiler) ? 'disponible' : 'no disponible',
            fotos: '',
            fecha_alta: row.fecha_ingreso || new Date().toISOString(),
            agente: row.nombre_contacto || 'Sin asignar',
            superficie_construida: parseFloat(row.superficie_construida) || 0,
            superficie_terreno: parseFloat(row.superficie_terreno) || 0,
            garages: parseInt(row.garages) || 0,
            piscina: row.piscina === '1' ? 1 : 0,
            parrillero: row.parrillero === '1' ? 1 : 0,
            calefaccion: row.calefaccion === '1' ? 1 : 0,
            amueblado: row.amueblado === '1' ? 1 : 0,
            ascensor: row.ascensor === '1' ? 1 : 0,
            seguridad: row.seguridad === '1' ? 1 : 0,
            gastos_comunes: parseFloat(row.gastos_comunes) || 0,
            web: row.web === '1' ? 1 : 0,
            web_destacada: row.web_destacada === '1' ? 1 : 0,
            padron: row.padron || ''
          };

          propiedades.push(prop);
        } catch (error) {
          errores++;
          console.error(`⚠️  Error procesando fila: ${error.message}`);
        }
      })
      .on('end', async () => {
        console.log(`📊 Se encontraron ${propiedades.length} propiedades en el CSV\n`);
        
        if (errores > 0) {
          console.log(`⚠️  ${errores} filas tuvieron errores y se saltaron\n`);
        }

        let insertadas = 0;
        let fallidas = 0;

        for (const prop of propiedades) {
          try {
            await insertarPropiedad(prop);
            insertadas++;
          } catch (error) {
            fallidas++;
          }
        }
        
        console.log(`\n✅ Insertadas: ${insertadas} propiedades`);
        if (fallidas > 0) {
          console.log(`❌ Fallidas: ${fallidas} propiedades\n`);
        }
        
        resolve();
      })
      .on('error', (error) => {
        console.error('❌ Error leyendo CSV:', error);
        reject(error);
      });
  });
}

// ============= PASO 3: INSERTAR PROPIEDAD =============
function insertarPropiedad(prop) {
  return new Promise((resolve, reject) => {
    if (!prop.referencia) {
      console.log('⚠️  Saltando propiedad sin referencia');
      resolve();
      return;
    }

    db.run(
      `INSERT OR REPLACE INTO propiedades 
       (id_propiedad_original, referencia, tipo, operacion, precio, habitaciones, 
        banos, metros, direccion, ciudad, departamento, zona, codigo_postal, 
        descripcion, caracteristicas, estado, fotos, fecha_alta, agente,
        superficie_construida, superficie_terreno, garages, piscina, parrillero,
        calefaccion, amueblado, ascensor, seguridad, gastos_comunes, 
        web, web_destacada, padron)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prop.id_propiedad_original,
        prop.referencia,
        prop.tipo,
        prop.operacion,
        prop.precio,
        prop.habitaciones,
        prop.banos,
        prop.metros,
        prop.direccion,
        prop.ciudad,
        prop.departamento,
        prop.zona,
        prop.codigo_postal,
        prop.descripcion,
        prop.caracteristicas,
        prop.estado,
        prop.fotos,
        prop.fecha_alta,
        prop.agente,
        prop.superficie_construida,
        prop.superficie_terreno,
        prop.garages,
        prop.piscina,
        prop.parrillero,
        prop.calefaccion,
        prop.amueblado,
        prop.ascensor,
        prop.seguridad,
        prop.gastos_comunes,
        prop.web,
        prop.web_destacada,
        prop.padron
      ],
      (err) => {
        if (err) {
          console.error(`❌ ${prop.referencia}: ${err.message}`);
          reject(err);
        } else {
          const precio_display = prop.precio > 0 ? `${prop.precio}€` : 'Sin precio';
          console.log(`✅ ${prop.referencia} - ${prop.tipo} en ${prop.operacion} - ${prop.ciudad || 'sin ciudad'} - ${precio_display}`);
          resolve();
        }
      }
    );
  });
}

// ============= GENERAR REFERENCIA =============
function generarReferencia() {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `REF-${fecha}-${random}`;
}

// ============= MOSTRAR ESTADÍSTICAS =============
function mostrarEstadisticas() {
  return new Promise((resolve) => {
    console.log('\n📊 ESTADÍSTICAS DE LA BASE DE DATOS:\n');
    console.log('='.repeat(80) + '\n');

    // Total de propiedades
    db.get('SELECT COUNT(*) as total FROM propiedades', [], (err, row) => {
      if (err) {
        console.error('❌ Error:', err);
        resolve();
        return;
      }

      console.log(`📦 Total de propiedades: ${row.total}\n`);

      // Por operación
      db.all(`
        SELECT operacion, COUNT(*) as cantidad 
        FROM propiedades 
        GROUP BY operacion
      `, [], (err, rows) => {
        if (!err && rows.length > 0) {
          console.log('📋 Por tipo de operación:');
          rows.forEach(r => {
            console.log(`   ${r.operacion}: ${r.cantidad}`);
          });
          console.log('');
        }

        // Por ciudad
        db.all(`
          SELECT ciudad, COUNT(*) as cantidad 
          FROM propiedades 
          WHERE ciudad != ''
          GROUP BY ciudad 
          ORDER BY cantidad DESC 
          LIMIT 10
        `, [], (err, rows) => {
          if (!err && rows.length > 0) {
            console.log('🏙️  Top 10 ciudades:');
            rows.forEach(r => {
              console.log(`   ${r.ciudad || 'Sin especificar'}: ${r.cantidad}`);
            });
            console.log('');
          }

          // Por tipo
          db.all(`
            SELECT tipo, COUNT(*) as cantidad 
            FROM propiedades 
            GROUP BY tipo 
            ORDER BY cantidad DESC
          `, [], (err, rows) => {
            if (!err && rows.length > 0) {
              console.log('🏠 Por tipo de propiedad:');
              rows.forEach(r => {
                console.log(`   ${r.tipo}: ${r.cantidad}`);
              });
              console.log('');
            }

            // Propiedades destacadas
            db.get(`
              SELECT COUNT(*) as cantidad 
              FROM propiedades 
              WHERE web_destacada = 1
            `, [], (err, row) => {
              if (!err) {
                console.log(`⭐ Propiedades destacadas: ${row.cantidad}\n`);
              }

              // Rango de precios
              db.get(`
                SELECT 
                  MIN(precio) as min_precio, 
                  MAX(precio) as max_precio, 
                  AVG(precio) as avg_precio 
                FROM propiedades 
                WHERE precio > 0
              `, [], (err, row) => {
                if (!err && row) {
                  console.log('💰 Precios:');
                  console.log(`   Mínimo: ${row.min_precio?.toLocaleString()}€`);
                  console.log(`   Máximo: ${row.max_precio?.toLocaleString()}€`);
                  console.log(`   Promedio: ${row.avg_precio?.toLocaleString()}€`);
                  console.log('');
                }
                resolve();
              });
            });
          });
        });
      });
    });
  });
}

// ============= MOSTRAR EJEMPLOS =============
function mostrarEjemplos() {
  return new Promise((resolve) => {
    console.log('📝 EJEMPLOS DE PROPIEDADES:\n');
    console.log('='.repeat(80) + '\n');
    
    db.all('SELECT * FROM propiedades LIMIT 5', [], (err, rows) => {
      if (err) {
        console.error('❌ Error:', err);
        resolve();
        return;
      }

      if (rows.length === 0) {
        console.log('⚠️  No hay propiedades en la base de datos\n');
      } else {
        rows.forEach((prop, index) => {
          console.log(`${index + 1}. ${prop.referencia}`);
          console.log(`   Tipo: ${prop.tipo} | Operación: ${prop.operacion}`);
          console.log(`   Ubicación: ${prop.direccion}, ${prop.ciudad}`);
          console.log(`   Precio: ${prop.precio?.toLocaleString()}€ | ${prop.habitaciones} hab | ${prop.banos} baños | ${prop.metros}m²`);
          
          const caract = JSON.parse(prop.caracteristicas || '[]');
          if (caract.length > 0) {
            console.log(`   Características: ${caract.join(', ')}`);
          }
          
          console.log('');
        });
      }
      
      resolve();
    });
  });
}

// ============= EJECUTAR IMPORTACIÓN =============
async function ejecutarImportacion() {
  try {
    console.log('🚀 INICIANDO IMPORTACIÓN DE PROPIEDADES\n');
    console.log('='.repeat(80) + '\n');

    // Paso 1: Crear tablas
    await crearTablas();

    // Paso 2: Importar propiedades
    const archivoCSV = './propiedades.csv';
    
    if (fs.existsSync(archivoCSV)) {
      await importarDesdeCSV(archivoCSV);
      
      // Paso 3: Mostrar estadísticas
      await mostrarEstadisticas();
      
      // Paso 4: Mostrar ejemplos
      await mostrarEjemplos();
    } else {
      console.log(`❌ No se encontró el archivo: ${archivoCSV}`);
      console.log('💡 Asegúrate de que el archivo esté en la carpeta actual\n');
    }

    console.log('='.repeat(80));
    console.log('✅ PROCESO COMPLETADO');
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ ERROR EN EL PROCESO:', error);
  } finally {
    db.close(() => {
      console.log('🔒 Base de datos cerrada');
    });
  }
}

// ============= EJECUTAR =============
if (require.main === module) {
  ejecutarImportacion();
}

module.exports = {
  crearTablas,
  importarDesdeCSV,
  insertarPropiedad,
  mostrarEstadisticas
};