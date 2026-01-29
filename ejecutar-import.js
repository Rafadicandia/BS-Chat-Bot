const {
    importarDesdeExcel,
    importarDesdeCSV,
    importarManualPDF
  } = require('./importar');
  
  async function main() {
    console.log('🚀 Iniciando importación...\n');
    
    try {
      // Importar propiedades (descomenta el que uses)
      console.log('📥 Importando propiedades...');
      await importarDesdeExcel('./propiedades.xlsx');
      // await importarDesdeCSV('./propiedades.csv');
      
      console.log('\n📚 Importando manual...');
      await importarManualPDF('./manual-gestion.pdf');
      
      console.log('\n✅ ¡Importación completada!');
    } catch (error) {
      console.error('❌ Error:', error);
    }
    
    process.exit(0);
  }
  
  main();